import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/credentials";

export type RuntimeIntegration = {
  id: string;
  productId: string;
  workspaceId: string;
};

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  if (token.length < 20 || token.length > 256) return null;
  return token;
}

export async function resolveRuntimeIntegration(
  token: string,
): Promise<
  | { ok: true; integration: RuntimeIntegration }
  | { ok: false; status: 401 | 403; code: string; message: string }
> {
  const admin = createAdminClient();
  const credentialHash = await sha256Hex(token);

  const { data: secret, error: secretError } = await admin
    .schema("private")
    .from("integration_secrets")
    .select("integration_id")
    .eq("credential_hash", credentialHash)
    .maybeSingle();

  if (secretError || !secret) {
    return {
      ok: false,
      status: 401,
      code: "invalid_integration_credential",
      message: "The integration credential is invalid.",
    };
  }

  const { data: integration } = await admin
    .from("integrations")
    .select("id, product_id, status, revoked_at")
    .eq("id", secret.integration_id)
    .maybeSingle();

  if (!integration) {
    return {
      ok: false,
      status: 401,
      code: "invalid_integration_credential",
      message: "The integration credential is invalid.",
    };
  }

  if (integration.status !== "active" || integration.revoked_at) {
    return {
      ok: false,
      status: 403,
      code: "integration_revoked",
      message: "This integration is no longer active.",
    };
  }

  const { data: product } = await admin
    .from("products")
    .select("id, workspace_id, understanding_status")
    .eq("id", integration.product_id)
    .maybeSingle();

  if (!product || product.understanding_status !== "confirmed") {
    return {
      ok: false,
      status: 403,
      code: "integration_not_ready",
      message: "This integration is not ready for runtime traffic.",
    };
  }

  const { data: capability } = await admin
    .from("workspace_capabilities")
    .select("capability")
    .eq("workspace_id", product.workspace_id)
    .eq("capability", "make_money")
    .eq("status", "active")
    .maybeSingle();

  if (!capability) {
    return {
      ok: false,
      status: 403,
      code: "make_money_not_active",
      message: "Runtime traffic is not enabled for this workspace.",
    };
  }

  return {
    ok: true,
    integration: {
      id: integration.id,
      productId: integration.product_id,
      workspaceId: product.workspace_id,
    },
  };
}
