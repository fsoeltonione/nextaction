import { createClient } from "@/utils/supabase/server";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";
import { CAPABILITIES, type Capability } from "@/lib/activation";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || !Array.isArray(body.capabilities)) throw new HttpError(400, "invalid_capabilities", "Choose one or two capabilities.");
    const capabilities = body.capabilities.filter((value): value is Capability => typeof value === "string" && CAPABILITIES.includes(value as Capability));
    if (capabilities.length !== body.capabilities.length || capabilities.length < 1 || capabilities.length > 2 || new Set(capabilities).size !== capabilities.length) throw new HttpError(400, "invalid_capabilities", "Choose one or two different capabilities.");

    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
    if (!workspaceId) throw new HttpError(409, "workspace_selection_required", "Select a workspace before saving the activation goal.");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");
    const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized to change this workspace.");

    const { data, error } = await supabase.rpc("set_workspace_capabilities_v2", { p_workspace_id: workspaceId, p_capabilities: capabilities });
    if (error) {
      if (error.code === "42501") return jsonError(requestId, 403, "not_authorized", "You are not authorized to change this workspace.");
      if (error.code === "22023" || error.code === "23505") return jsonError(requestId, 400, "invalid_capabilities", "The capability selection is invalid.");
      console.error("Capability update failed", { requestId, code: error.code });
      return jsonError(requestId, 500, "capability_update_failed", "Unable to save your capability selection.");
    }

    return jsonSuccess({ capabilities: [...new Set((data ?? []).map((row) => row.capability))] }, requestId);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Capability route failed", { requestId, error });
    return jsonError(requestId, 500, "capability_update_failed", "Unable to save your capability selection.");
  }
}
