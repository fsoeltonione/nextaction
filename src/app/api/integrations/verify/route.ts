import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/credentials";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.token !== "string") throw new HttpError(400, "invalid_token", "A connection token is required.");
    const token = body.token.trim();
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
    if (token.length < 20 || token.length > 256) throw new HttpError(400, "invalid_token", "The connection token is invalid.");
    if (!workspaceId) throw new HttpError(409, "workspace_selection_required", "Select a workspace before verifying the connection.");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");
    const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized for this workspace.");

    let admin;
    try { admin = createAdminClient(); } catch { return jsonError(requestId, 503, "integration_not_configured", "Integration verification is not available yet."); }
    const credentialHash = await sha256Hex(token);
    const { data: credentialResult, error: credentialError } = await admin.rpc("resolve_integration_credential_v2", {
      p_credential_hash: credentialHash,
    });
    if (credentialError) {
      console.error("Integration credential lookup failed", { requestId, code: credentialError.code });
      return jsonError(requestId, 500, "verification_failed", "Unable to verify the connection.");
    }

    const credential = credentialResult?.[0];
    if (!credential || typeof credential.result_integration_id !== "string") {
      return jsonError(requestId, 401, "invalid_token", "The connection token is invalid.");
    }

    const { data: integration } = await admin.from("integrations").select("id, product_id, status").eq("id", credential.result_integration_id).maybeSingle();
    if (!integration || integration.status !== "active") return jsonError(requestId, 403, "integration_revoked", "This connection is no longer active.");

    const { data: product } = await admin.from("products").select("id, workspace_id").eq("id", integration.product_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return jsonError(requestId, 403, "not_authorized", "This connection does not belong to the selected workspace.");

    const { data: capability } = await supabase.from("workspace_capabilities").select("capability").eq("workspace_id", workspaceId).eq("capability", "make_money").eq("status", "active").maybeSingle();
    if (!capability) return jsonError(requestId, 409, "capability_not_selected", "Select Make Money before verifying a product connection.");

    const { error } = await admin.from("integrations").update({ last_seen_at: new Date().toISOString() }).eq("id", integration.id);
    if (error) { console.error("Integration verification update failed", { requestId, code: error.code }); return jsonError(requestId, 500, "verification_failed", "Unable to verify the connection."); }
    return jsonSuccess({ verified: true, integration_id: integration.id }, requestId);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Integration verification route failed", { requestId, error });
    return jsonError(requestId, 500, "verification_failed", "Unable to verify the connection.");
  }
}
