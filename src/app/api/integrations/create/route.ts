import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { generateIntegrationToken, sha256Hex } from "@/lib/credentials";
import { createRequestId, jsonError, jsonSuccess, readJsonBody, isRecord, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.product_id !== "string") {
      throw new HttpError(400, "invalid_product", "A product is required.");
    }

    const productId = body.product_id.trim();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");

    const { data: product } = await supabase
      .from("products")
      .select("id, workspace_id")
      .eq("id", productId)
      .maybeSingle();

    if (!product) return jsonError(requestId, 404, "product_not_found", "Product not found.");

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", product.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) return jsonError(requestId, 403, "not_authorized", "You are not authorized for this product.");

    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return jsonError(requestId, 503, "integration_not_configured", "Integration setup is not available yet.");
    }

    const { data: existing } = await admin
      .from("integrations")
      .select("id, last_seen_at, status")
      .eq("product_id", product.id)
      .eq("name", "NextAction Runtime")
      .maybeSingle();

    if (existing?.last_seen_at) {
      return jsonError(requestId, 409, "integration_already_verified", "This product already has a verified connection.");
    }

    let integrationId = existing?.id;
    if (!integrationId) {
      const { data: created, error } = await admin
        .from("integrations")
        .insert({ product_id: product.id, name: "NextAction Runtime", status: "active", last_seen_at: null })
        .select("id")
        .single();
      if (error || !created) {
        console.error("Integration creation failed", { requestId, code: error?.code });
        return jsonError(requestId, 500, "integration_creation_failed", "Unable to create the integration.");
      }
      integrationId = created.id;
    }

    const token = generateIntegrationToken();
    const credentialHash = await sha256Hex(token);

    const { error: secretError } = await admin
      .schema("private")
      .from("integration_secrets")
      .upsert({
        integration_id: integrationId,
        credential_hash: credentialHash,
        rotated_at: new Date().toISOString(),
      });

    if (secretError) {
      console.error("Integration secret creation failed", { requestId, code: secretError.code });
      return jsonError(requestId, 500, "integration_secret_failed", "Unable to finish integration setup.");
    }

    await admin
      .from("integrations")
      .update({ last_seen_at: null, status: "active", revoked_at: null })
      .eq("id", integrationId);

    return jsonSuccess({
      integration: { id: integrationId, verified: false },
      credential: { token },
    }, requestId, 201);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Integration creation route failed", { requestId, error });
    return jsonError(requestId, 500, "integration_creation_failed", "Unable to create the integration.");
  }
}