import { createRequestId, jsonError, jsonSuccess } from "@/lib/http";
import { extractBearerToken, resolveRuntimeIntegration } from "@/lib/runtime/auth";
import { getRequestIp } from "@/lib/runtime/http";
import { checkRateLimit } from "@/lib/runtime/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

function failure(requestId: string, status: number, code: string, message: string) {
  return jsonError(requestId, status, code, message);
}

function rateLimited(requestId: string, retryAfterSeconds: number) {
  const response = failure(requestId, 429, "rate_limited", "Too many requests. Please retry later.");
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

/**
 * Server-side handshake. This validates a runtime credential and records
 * successful authenticated connectivity without accepting or enqueueing an Event.
 *
 * CORS is intentionally omitted: na_live_ credentials are server secrets,
 * not a browser tracking key.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const authGuard = await checkRateLimit("runtime:connection-verify:auth", getRequestIp(request), 300);
    if (!authGuard.allowed) return rateLimited(requestId, authGuard.retry_after_seconds);

    const token = extractBearerToken(request);
    if (!token) return failure(requestId, 401, "invalid_integration_credential", "A valid integration credential is required.");
    const resolved = await resolveRuntimeIntegration(token);
    if (!resolved.ok) return failure(requestId, resolved.status, resolved.code, resolved.message);

    const integrationLimit = await checkRateLimit("runtime:connection-verify", resolved.integration.id, 30);
    if (!integrationLimit.allowed) return rateLimited(requestId, integrationLimit.retry_after_seconds);

    const admin = createAdminClient();
    const verifiedAt = new Date().toISOString();
    const { data: integration, error } = await admin.from("integrations")
      .update({ last_seen_at: verifiedAt })
      .eq("id", resolved.integration.id).eq("status", "active").is("revoked_at", null)
      .select("id").maybeSingle();

    if (error) {
      console.error("Runtime connection verification update failed", { requestId, code: error.code });
      return failure(requestId, 503, "connection_verification_unavailable", "Connection verification is temporarily unavailable.");
    }
    if (!integration) return failure(requestId, 403, "integration_not_active", "This connection is no longer active.");
    return jsonSuccess({ verified: true, integration_id: integration.id, verified_at: verifiedAt }, requestId);
  } catch (error) {
    if (error instanceof Error && error.message === "Rate limit service unavailable.") {
      return failure(requestId, 503, "rate_limit_unavailable", "Runtime protection is temporarily unavailable.");
    }
    console.error("Runtime connection verification failed", { requestId, error });
    return failure(requestId, 503, "connection_verification_unavailable", "Connection verification is temporarily unavailable.");
  }
}
