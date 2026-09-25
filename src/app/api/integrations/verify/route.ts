import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/credentials";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.token !== "string") {
      throw new HttpError(400, "invalid_token", "A connection token is required.");
    }

    const token = body.token.trim();
    if (token.length < 20 || token.length > 256) {
      throw new HttpError(400, "invalid_token", "The connection token is invalid.");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");

    let admin;
    try { admin = createAdminClient(); }
    catch { return jsonError(requestId, 503, "integration_not_configured", "Integration verification is not available yet."); }

    const credentialHash = await sha256Hex(token);
    const { data: secret } = await admin
      .schema("private")
      .from("integration_secrets")
      .select("integration_id")
      .eq("credential_hash", credentialHash)
      .maybeSingle();

    if (!secret) return jsonError(requestId, 401, "invalid_token", "The connection token is invalid.");

    const { data: integration } = await admin
      .from("integrations")
      .select("id, product_id, status")
      .eq("id", secret.integration_id)
      .maybeSingle();

    if (!integration || integration.status !== "active") {
      return jsonError(requestId, 403, "integration_revoked", "This connection is no longer active.");
    }

    const { data: product } = await admin
      .from("products")
      .select("id, workspace_id")
      .eq("id", integration.product_id)
      .maybeSingle();

    if (!product) return jsonError(requestId, 404, "product_not_found", "Product not found.");

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", product.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized for this product.");

    const { error } = await admin
      .from("integrations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", integration.id);

    if (error) {
      console.error("Integration verification update failed", { requestId, code: error.code });
      return jsonError(requestId, 500, "verification_failed", "Unable to verify the connection.");
    }

    return jsonSuccess({ verified: true, integration_id: integration.id }, requestId);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Integration verification route failed", { requestId, error });
    return jsonError(requestId, 500, "verification_failed", "Unable to verify the connection.");
  }
}