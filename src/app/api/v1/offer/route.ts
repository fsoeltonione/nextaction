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
import { generateIntegrationToken, sha256Hex } from "@/lib/credentials";
import { createAdminClient } from "@/utils/supabase/admin";

const MOMENT_KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_CONTEXT_BYTES = 8 * 1024;
const DELIVERY_TTL_SECONDS = 300;

function failure(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return withRuntimeCors(jsonError(requestId, status, code, message));
}

export function OPTIONS() {
  return runtimeOptionsResponse();
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const token = extractBearerToken(request);
    if (!token) {
      const limit = await checkRateLimit(
        "runtime:offer:auth",
        getRequestIp(request),
        20,
      );

      if (!limit.allowed) {
        const response = failure(
          requestId,
          429,
          "rate_limited",
          "Too many requests. Please retry later.",
        );
        response.headers.set(
          "Retry-After",
          String(limit.retry_after_seconds),
        );
        return response;
      }

      return failure(
        requestId,
        401,
        "invalid_integration_credential",
        "A valid integration credential is required.",
      );
    }

    const resolved = await resolveRuntimeIntegration(token);
    if (!resolved.ok) {
      if (resolved.status === 401) {
        const limit = await checkRateLimit(
          "runtime:offer:auth",
          getRequestIp(request),
          20,
        );

        if (!limit.allowed) {
          const response = failure(
            requestId,
            429,
            "rate_limited",
            "Too many requests. Please retry later.",
          );
          response.headers.set(
            "Retry-After",
            String(limit.retry_after_seconds),
          );
          return response;
        }
      }

      return failure(
        requestId,
        resolved.status,
        resolved.code,
        resolved.message,
      );
    }

    const rateLimit = await checkRateLimit(
      "runtime:offer",
      resolved.integration.id,
      60,
    );

    if (!rateLimit.allowed) {
      const response = failure(
        requestId,
        429,
        "rate_limited",
        "Too many requests. Please retry later.",
      );
      response.headers.set(
        "Retry-After",
        String(rateLimit.retry_after_seconds),
      );
      return response;
    }

    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new HttpError(400, "invalid_offer_request", "Offer request must be an object.");
    }

    const momentKey =
      typeof body.moment_key === "string" ? body.moment_key.trim() : "";

    if (!MOMENT_KEY_RE.test(momentKey) || momentKey.length > 100) {
      throw new HttpError(
        400,
        "invalid_moment_key",
        "Moment key is invalid.",
      );
    }

    if (body.context !== undefined) {
      if (!isRecord(body.context)) {
        throw new HttpError(
          400,
          "invalid_context",
          "Context must be an object.",
        );
      }

      const contextBytes = new TextEncoder().encode(
        JSON.stringify(body.context),
      ).byteLength;

      if (contextBytes > MAX_CONTEXT_BYTES) {
        throw new HttpError(
          413,
          "context_too_large",
          "Context is too large.",
        );
      }
    }

    const deliveryToken = generateIntegrationToken().replace(
      /^na_live_/,
      "na_del_",
    );
    const deliveryTokenHash = await sha256Hex(deliveryToken);
    const deliveryNonce = generateIntegrationToken().replace(
      /^na_live_/,
      "na_nonce_",
    );
    const expiresAt = new Date(
      Date.now() + DELIVERY_TTL_SECONDS * 1000,
    ).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "runtime_create_decision_delivery",
      {
        p_integration_id: resolved.integration.id,
        p_moment_key: momentKey,
        p_request_id: requestId,
        p_delivery_nonce: deliveryNonce,
        p_delivery_token_hash: deliveryTokenHash,
        p_expires_at: expiresAt,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return failure(
          requestId,
          403,
          "runtime_not_authorized",
          "Runtime decision is not available for this integration.",
        );
      }

      if (error.code === "22023") {
        return failure(
          requestId,
          400,
          "invalid_offer_request",
          "The offer request is invalid.",
        );
      }

      console.error("Runtime offer decision failed", {
        requestId,
        code: error.code,
      });

      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Runtime decisions are temporarily unavailable.",
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.result_outcome) {
      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Runtime decisions are temporarily unavailable.",
      );
    }

    if (row.result_outcome === "no_fill") {
      return withRuntimeCors(new Response(null, { status: 204 }));
    }

    return withRuntimeCors(
      jsonSuccess(
        {
          delivery: {
            token: deliveryToken,
            offer: {
              title: row.result_title,
              description: row.result_description,
              cta_label: row.result_cta_label,
            },
            expires_at: row.result_expires_at,
          },
        },
        requestId,
        200,
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

    console.error("Runtime offer route failed", { requestId, error });
    return failure(
      requestId,
      500,
      "runtime_error",
      "Unable to make the offer decision.",
    );
  }
}
