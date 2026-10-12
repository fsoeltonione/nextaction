import {
  createRequestId,
  HttpError,
  isRecord,
  jsonError,
  jsonSuccess,
  readJsonBody,
} from "@/lib/http";
import { getRequestIp, runtimeOptionsResponse, withRuntimeCors } from "@/lib/runtime/http";
import { checkRateLimit } from "@/lib/runtime/rate-limit";
import { generateIntegrationToken, sha256Hex } from "@/lib/credentials";
import { createAdminClient } from "@/utils/supabase/admin";

const MOMENT_KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_CONTEXT_BYTES = 8 * 1024;
const DELIVERY_TTL_SECONDS = 300;
const OCCURRENCE_WAIT_ATTEMPTS = 4;
const OCCURRENCE_WAIT_MS = 75;

function failure(requestId: string, status: number, code: string, message: string) {
  return withRuntimeCors(jsonError(requestId, status, code, message));
}

function rateLimited(requestId: string, retryAfterSeconds: number) {
  const response = failure(requestId, 429, "rate_limited", "Too many requests. Please retry later.");
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function OPTIONS() {
  return runtimeOptionsResponse();
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const ipLimit = await checkRateLimit("runtime:public-offer:ip", getRequestIp(request), 120);
    if (!ipLimit.allowed) return rateLimited(requestId, ipLimit.retry_after_seconds);

    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new HttpError(400, "invalid_offer_request", "Offer request must be an object.");

    const publisherKey = typeof body.publisher_key === "string" ? body.publisher_key.trim() : "";
    const momentKey = typeof body.moment_key === "string" ? body.moment_key.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publisherKey)) {
      throw new HttpError(400, "invalid_publisher_key", "Publisher key is invalid.");
    }
    if (!MOMENT_KEY_RE.test(momentKey) || momentKey.length > 100) {
      throw new HttpError(400, "invalid_moment_key", "Moment key is invalid.");
    }

    if (body.context !== undefined) {
      if (!isRecord(body.context)) throw new HttpError(400, "invalid_context", "Context must be an object.");
      const contextBytes = new TextEncoder().encode(JSON.stringify(body.context)).byteLength;
      if (contextBytes > MAX_CONTEXT_BYTES) throw new HttpError(413, "context_too_large", "Context is too large.");
    }

    const integrationLimit = await checkRateLimit("runtime:public-offer:publisher", publisherKey, 60);
    if (!integrationLimit.allowed) return rateLimited(requestId, integrationLimit.retry_after_seconds);

    const admin = createAdminClient();
    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, product_id, status, revoked_at")
      .eq("id", publisherKey)
      .eq("status", "active")
      .is("revoked_at", null)
      .maybeSingle();

    if (integrationError) {
      console.error("Public offer integration lookup failed", { requestId, code: integrationError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    if (!integration) return failure(requestId, 404, "publisher_not_found", "Publisher was not found.");

    const { data: product, error: productError } = await admin
      .from("products")
      .select("id, understanding_status, workspace_id")
      .eq("id", integration.product_id)
      .maybeSingle();
    if (productError) {
      console.error("Public offer product lookup failed", { requestId, code: productError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    if (!product || product.understanding_status !== "confirmed") {
      return failure(requestId, 403, "publisher_not_ready", "Publisher setup is not complete.");
    }

    const { data: capability, error: capabilityError } = await admin
      .from("workspace_capabilities")
      .select("workspace_id")
      .eq("workspace_id", product.workspace_id)
      .eq("capability", "make_money")
      .eq("status", "active")
      .maybeSingle();
    if (capabilityError) {
      console.error("Public offer capability lookup failed", { requestId, code: capabilityError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    if (!capability) return failure(requestId, 403, "publisher_not_ready", "Publisher setup is not complete.");

    const { data: moment, error: momentError } = await admin
      .from("moments")
      .select("id, moment_key")
      .eq("product_id", product.id)
      .eq("moment_key", momentKey)
      .eq("status", "active")
      .maybeSingle();
    if (momentError) {
      console.error("Public offer Moment lookup failed", { requestId, code: momentError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    if (!moment) return withRuntimeCors(new Response(null, { status: 204 }));

    // Browser embeds identify an integration but never receive the server credential.
    // Record the explicit Moment through the same Event -> worker -> occurrence pipeline
    // used by the existing runtime. The idempotency key is unique per invocation.
    const eventAt = new Date().toISOString();
    const idempotencyKey = `embed-${crypto.randomUUID()}`;
    const { data: acceptedRows, error: acceptError } = await admin.rpc("runtime_accept_event", {
      p_integration_id: integration.id,
      p_idempotency_key: idempotencyKey,
      p_event_type: momentKey,
      p_occurred_at: eventAt,
      p_payload: isRecord(body.context) ? body.context : {},
      p_request_id: requestId,
    });
    if (acceptError) {
      if (acceptError.code === "42501") return failure(requestId, 403, "publisher_not_ready", "Publisher setup is not complete.");
      console.error("Public embed Event acceptance failed", { requestId, code: acceptError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    const accepted = Array.isArray(acceptedRows) ? acceptedRows[0] : acceptedRows;
    if (!accepted?.result_event_id) return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");

    // Try a bounded synchronous processing pass to avoid waiting for the once-per-minute
    // scheduler. The normal worker remains responsible for queued events if this times out.
    const { data: processedRows, error: processError } = await admin.rpc("runtime_process_event", {
      p_event_id: accepted.result_event_id,
    });
    if (processError) {
      console.error("Public embed Event processing deferred to worker", { requestId, code: processError.code });
    } else {
      const processed = Array.isArray(processedRows) ? processedRows[0] : processedRows;
      if (!processed?.result_processed || !processed?.result_moment_occurrence_id) {
        // Unknown/disabled moment or an unprocessable event is a normal no-fill.
        return withRuntimeCors(new Response(null, { status: 204 }));
      }
    }

    let occurrenceReady = false;
    for (let attempt = 0; attempt < OCCURRENCE_WAIT_ATTEMPTS; attempt += 1) {
      const { data: occurrence, error: occurrenceError } = await admin
        .from("moment_occurrences")
        .select("id")
        .eq("integration_id", integration.id)
        .eq("moment_id", moment.id)
        .gte("occurred_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!occurrenceError && occurrence?.id) {
        occurrenceReady = true;
        break;
      }
      if (occurrenceError) {
        console.error("Public embed occurrence lookup failed", { requestId, code: occurrenceError.code });
        return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
      }
      if (attempt < OCCURRENCE_WAIT_ATTEMPTS - 1) await delay(OCCURRENCE_WAIT_MS);
    }
    if (!occurrenceReady) return withRuntimeCors(new Response(null, { status: 204 }));

    const deliveryToken = generateIntegrationToken().replace(/^na_live_/, "na_del_");
    const deliveryTokenHash = await sha256Hex(deliveryToken);
    const deliveryNonce = generateIntegrationToken().replace(/^na_live_/, "na_nonce_");
    const expiresAt = new Date(Date.now() + DELIVERY_TTL_SECONDS * 1000).toISOString();

    const { data, error } = await admin.rpc("runtime_create_decision_delivery", {
      p_integration_id: integration.id,
      p_moment_key: momentKey,
      p_request_id: requestId,
      p_delivery_nonce: deliveryNonce,
      p_delivery_token_hash: deliveryTokenHash,
      p_expires_at: expiresAt,
    });

    if (error) {
      if (error.code === "42501") return failure(requestId, 403, "runtime_not_authorized", "Runtime decision is not available for this publisher.");
      if (error.code === "22023") return failure(requestId, 400, "invalid_offer_request", "The offer request is invalid.");
      console.error("Public runtime offer decision failed", { requestId, code: error.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.result_outcome) return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    if (row.result_outcome === "no_fill") return withRuntimeCors(new Response(null, { status: 204 }));

    return withRuntimeCors(jsonSuccess({
      delivery: {
        token: deliveryToken,
        click_url: new URL(`/v1/click/${encodeURIComponent(deliveryToken)}`, request.url).toString(),
        offer: {
          title: row.result_title,
          description: row.result_description,
          cta_label: row.result_cta_label,
        },
        expires_at: row.result_expires_at,
      },
    }, requestId));
  } catch (error) {
    if (error instanceof HttpError) return failure(requestId, error.status, error.code, error.message);
    if (error instanceof Error && error.message === "Rate limit service unavailable.") {
      return failure(requestId, 503, "rate_limit_unavailable", "Runtime protection is temporarily unavailable.");
    }
    console.error("Public offer route failed", { requestId, error });
    return failure(requestId, 500, "runtime_error", "Unable to make the offer decision.");
  }
}
