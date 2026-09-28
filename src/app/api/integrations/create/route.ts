import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { generateIntegrationToken, sha256Hex } from "@/lib/credentials";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.product_id !== "string") throw new HttpError(400, "invalid_product", "A product is required.");
    const productId = body.product_id.trim();
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
    if (!workspaceId) throw new HttpError(409, "workspace_selection_required", "Select a workspace before creating a product connection.");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized for this workspace.");

    const { data: product } = await supabase
      .from("products")
      .select("id, workspace_id")
      .eq("id", productId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!product) return jsonError(requestId, 404, "product_not_found", "Product not found in the selected workspace.");

    const { data: capability } = await supabase
      .from("workspace_capabilities")
      .select("capability")
      .eq("workspace_id", workspaceId)
      .eq("capability", "make_money")
      .eq("status", "active")
      .maybeSingle();
    if (!capability) return jsonError(requestId, 409, "capability_not_selected", "Select Make Money before creating a product connection.");

    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return jsonError(requestId, 503, "integration_not_configured", "Integration setup is not available yet.");
    }

    const token = generateIntegrationToken();
    const credentialHash = await sha256Hex(token);
    const { data, error } = await admin.rpc("provision_integration_credential_v2", {
      p_product_id: product.id,
      p_credential_hash: credentialHash,
    });

    if (error) {
      if (error.code === "P0001" || error.code === "23505") {
        return jsonError(requestId, 409, "integration_already_verified", "This product already has a verified connection.");
      }
      console.error("Integration credential provisioning failed", { requestId, code: error.code });
      return jsonError(requestId, 500, "integration_creation_failed", "Unable to finish integration setup.");
    }

    const result = data?.[0];
    if (!result || typeof result.result_integration_id !== "string") {
      console.error("Integration credential provisioning returned no result", { requestId });
      return jsonError(requestId, 500, "integration_creation_failed", "Unable to finish integration setup.");
    }

    return jsonSuccess({
      integration: { id: result.result_integration_id, verified: false },
      credential: { token },
    }, requestId, 201);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Integration creation route failed", { requestId, error });
    return jsonError(requestId, 500, "integration_creation_failed", "Unable to create the integration.");
  }
}
