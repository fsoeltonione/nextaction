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

function failure(requestId: string, status: number, code: string, message: string) {
  return withRuntimeCors(jsonError(requestId, status, code, message));
}

export function OPTIONS() {
  return runtimeOptionsResponse();
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const ipLimit = await checkRateLimit("runtime:public-offer:ip", getRequestIp(request), 120);
    if (!ipLimit.allowed) {
      const response = failure(requestId, 429, "rate_limited", "Too many requests. Please retry later.");
      response.headers.set("Retry-After", String(ipLimit.retry_after_seconds));
      return response;
    }

    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new HttpError(400, "invalid_offer_request", "Offer request must be an object.");

    const publisherKey = typeof body.publisher_key === "string" ? body.publisher_key.trim() : "";
    const momentKey = typeof body.moment_key === "string" ? body.moment_key.trim() : "";
    if (!publisherKey || publisherKey.length > 128) throw new HttpError(400, "invalid_publisher_key", "Publisher key is invalid.");
    if (!MOMENT_KEY_RE.test(momentKey) || momentKey.length > 100) throw new HttpError(400, "invalid_moment_key", "Moment key is invalid.");

    if (body.context !== undefined) {
      if (!isRecord(body.context)) throw new HttpError(400, "invalid_context", "Context must be an object.");
      const contextBytes = new TextEncoder().encode(JSON.stringify(body.context)).byteLength;
      if (contextBytes > MAX_CONTEXT_BYTES) throw new HttpError(413, "context_too_large", "Context is too large.");
    }

    const integrationLimit = await checkRateLimit("runtime:public-offer:publisher", publisherKey, 60);
    if (!integrationLimit.allowed) {
      const response = failure(requestId, 429, "rate_limited", "This publisher has reached its request limit.");
      response.headers.set("Retry-After", String(integrationLimit.retry_after_seconds));
      return response;
    }

    // The integration UUID is intentionally a public identifier for the browser embed.
    // It is not a credential and cannot be used to provision, mutate, or settle anything.
    const admin = createAdminClient();
    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, product_id, status")
      .eq("id", publisherKey)
      .eq("status", "active")
      .maybeSingle();

    if (integrationError) {
      console.error("Public offer integration lookup failed", { requestId, code: integrationError.code });
      return failure(requestId, 503, "runtime_unavailable", "Runtime decisions are temporarily unavailable.");
    }
    if (!integration) return failure(requestId, 404, "publisher_not_found", "Publisher was not found.");

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
    if (error instanceof Error && error.message === "Rate limit service unavailable.") return failure(requestId, 503, "rate_limit_unavailable", "Runtime protection is temporarily unavailable.");
    console.error("Public offer route failed", { requestId, error });
    return failure(requestId, 500, "runtime_error", "Unable to make the offer decision.");
  }
}
