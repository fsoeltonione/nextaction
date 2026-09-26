import {
  createRequestId,
  HttpError,
  isRecord,
  jsonError,
  jsonSuccess,
  readJsonBody,
} from "@/lib/http";
import {
  extractBearerToken,
  resolveRuntimeIntegration,
} from "@/lib/runtime/auth";
import {
  getRequestIp,
  runtimeOptionsResponse,
  withRuntimeCors,
} from "@/lib/runtime/http";
import { checkRateLimit } from "@/lib/runtime/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

const EVENT_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function failure(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return withRuntimeCors(jsonError(requestId, status, code, message));
}

function rateLimited(
  requestId: string,
  retryAfterSeconds: number,
) {
  const response = failure(
    requestId,
    429,
    "rate_limited",
    "Too many requests. Please retry later.",
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export function OPTIONS() {
  return runtimeOptionsResponse();
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  let runtimeStage = "start";

  try {
    runtimeStage = "auth_rate_limit";
    // Cheap IP guard runs before credential lookup to reduce brute-force
    // pressure on the integration_secrets lookup.
    const authGuard = await checkRateLimit(
      "runtime:track:auth",
      getRequestIp(request),
      300,
    );

    if (!authGuard.allowed) {
      return rateLimited(requestId, authGuard.retry_after_seconds);
    }

    runtimeStage = "credential_extraction";
    const token = extractBearerToken(request);
    if (!token) {
      return failure(
        requestId,
        401,
        "invalid_integration_credential",
        "A valid integration credential is required.",
      );
    }

    runtimeStage = "integration_resolution";
    const resolved = await resolveRuntimeIntegration(token);
    if (!resolved.ok) {
      return failure(
        requestId,
        resolved.status,
        resolved.code,
        resolved.message,
      );
    }

    runtimeStage = "integration_rate_limit";
    const rateLimit = await checkRateLimit(
      "runtime:track",
      resolved.integration.id,
      120,
    );

    if (!rateLimit.allowed) {
      return rateLimited(requestId, rateLimit.retry_after_seconds);
    }

    runtimeStage = "body_parse";
    const body = await readJsonBody(request);

    if (!isRecord(body)) {
      throw new HttpError(
        400,
        "invalid_event",
        "Event payload must be an object.",
      );
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new HttpError(
        400,
        "missing_idempotency_key",
        "Idempotency-Key is required.",
      );
    }

    const eventType = typeof body.type === "string" ? body.type.trim() : "";
    if (!EVENT_TYPE_RE.test(eventType)) {
      throw new HttpError(
        400,
        "invalid_event_type",
        "Event type is invalid.",
      );
    }

    if (!isRecord(body.data)) {
      throw new HttpError(
        400,
        "invalid_event_data",
        "Event data must be an object.",
      );
    }

    let occurredAt: string | null = null;
    if (body.occurred_at !== undefined) {
      if (typeof body.occurred_at !== "string") {
        throw new HttpError(
          400,
          "invalid_occurred_at",
          "occurred_at must be an ISO timestamp.",
        );
      }

      const parsed = new Date(body.occurred_at);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(
          400,
          "invalid_occurred_at",
          "occurred_at must be an ISO timestamp.",
        );
      }
      occurredAt = parsed.toISOString();
    }

    runtimeStage = "event_acceptance_rpc";
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("runtime_accept_event", {
      p_integration_id: resolved.integration.id,
      p_idempotency_key: idempotencyKey,
      p_event_type: eventType,
      p_occurred_at: occurredAt,
      p_payload: body.data,
      p_request_id: requestId,
    });

    if (error) {
      if (error.code === "42501") {
        return failure(
          requestId,
          403,
          "integration_not_active",
          "This integration is not active.",
        );
      }

      if (error.code === "22023") {
        return failure(
          requestId,
          400,
          "invalid_event",
          "The event payload is invalid.",
        );
      }

      if (error.code === "23505") {
        return failure(
          requestId,
          409,
          "idempotency_conflict",
          "The Idempotency-Key was already used with different event data.",
        );
      }

      console.error("Runtime event acceptance failed", {
        requestId,
        code: error.code,
      });

      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Runtime ingestion is temporarily unavailable.",
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.result_event_id) {
      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Runtime ingestion is temporarily unavailable.",
      );
    }

    return withRuntimeCors(
      jsonSuccess(
        {
          accepted: true,
          event_id: row.result_event_id,
          idempotent_replay: !Boolean(row.result_created),
        },
        requestId,
        202,
      ),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return failure(requestId, error.status, error.code, error.message);
    }

    if (
      error instanceof Error &&
      error.message === "Rate limit service unavailable."
    ) {
      return failure(
        requestId,
        503,
        "rate_limit_unavailable",
        "Runtime protection is temporarily unavailable.",
      );
    }

    console.error("Runtime track route failed", {
      requestId,
      runtimeStage,
      error,
    });

    const isStaging =
      process.env.NEXT_PUBLIC_APP_ENV === "staging" ||
      process.env.APP_ENV === "staging";

    if (isStaging) {
      let debugReason = "unclassified_exception";

      if (
        error instanceof Error &&
        error.message === "Supabase server credentials are not configured."
      ) {
        debugReason = "supabase_credentials_missing";
      } else if (
        error instanceof Error &&
        error.message === "Rate limit service returned no result."
      ) {
        debugReason = "rate_limit_empty_result";
      } else if (
        error instanceof Error &&
        error.message.includes("crypto")
      ) {
        debugReason = "crypto_runtime_error";
      }

      return withRuntimeCors(
        jsonSuccess(
          {
            error: {
              code: "runtime_error",
              message: "Unable to accept the event.",
              debug_stage: runtimeStage,
              debug_reason: debugReason,
            },
          },
          requestId,
          500,
        ),
      );
    }

    return failure(
      requestId,
      500,
      "runtime_error",
      "Unable to accept the event.",
    );
  }
}
