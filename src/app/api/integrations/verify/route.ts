import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.integration_id !== "string") {
      throw new HttpError(400, "invalid_integration", "An integration ID is required to check connection status.");
    }
    const integrationId = body.integration_id.trim();
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
    if (!integrationId || !workspaceId) {
      throw new HttpError(400, "invalid_integration", "A workspace and integration ID are required.");
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");
    const { data: membership } = await supabase.from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized for this workspace.");

    let admin;
    try { admin = createAdminClient(); }
    catch { return jsonError(requestId, 503, "integration_not_configured", "Connection status is not available yet."); }

    const { data: integration, error: integrationError } = await admin.from("integrations")
      .select("id, product_id, status, last_seen_at").eq("id", integrationId).maybeSingle();
    if (integrationError) {
      console.error("Integration status lookup failed", { requestId, code: integrationError.code });
      return jsonError(requestId, 500, "verification_failed", "Unable to check connection status.");
    }
    if (!integration || integration.status !== "active") {
      return jsonError(requestId, 404, "integration_not_found", "An active connection was not found.");
    }
    const { data: product } = await admin.from("products").select("id, workspace_id")
      .eq("id", integration.product_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return jsonError(requestId, 403, "not_authorized", "This connection does not belong to the selected workspace.");

    const { data: capability } = await supabase.from("workspace_capabilities").select("capability")
      .eq("workspace_id", workspaceId).eq("capability", "make_money").eq("status", "active").maybeSingle();
    if (!capability) return jsonError(requestId, 409, "capability_not_selected", "Select Make Money before checking connection status.");

    return jsonSuccess({ integration_id: integration.id, verified: Boolean(integration.last_seen_at), verified_at: integration.last_seen_at }, requestId);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Integration status check failed", { requestId, error });
    return jsonError(requestId, 500, "verification_failed", "Unable to check connection status.");
  }
}
