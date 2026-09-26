import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/credentials";

export type RuntimeIntegration = {
  id: string;
  productId: string;
  workspaceId: string;
};

type RuntimeResolutionRow = {
  result_status: string;
  result_integration_id: string | null;
  result_product_id: string | null;
  result_workspace_id: string | null;
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
  | { ok: false; status: 401 | 403 | 503; code: string; message: string }
> {
  const admin = await createAdminClient();
  const credentialHash = await sha256Hex(token);

  const { data, error } = await admin.rpc("resolve_runtime_integration", {
    p_credential_hash: credentialHash,
  });

  if (error) {
    console.error("Runtime integration resolution failed", {
      code: error.code,
    });
    return {
      ok: false,
      status: 503,
      code: "runtime_unavailable",
      message: "Runtime authentication is temporarily unavailable.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RuntimeResolutionRow
    | null;

  if (!row) {
    return {
      ok: false,
      status: 401,
      code: "invalid_integration_credential",
      message: "The integration credential is invalid.",
    };
  }

  if (row.result_status === "invalid_integration_credential") {
    return {
      ok: false,
      status: 401,
      code: row.result_status,
      message: "The integration credential is invalid.",
    };
  }

  if (row.result_status === "integration_revoked") {
    return {
      ok: false,
      status: 403,
      code: row.result_status,
      message: "This integration is no longer active.",
    };
  }

  if (row.result_status === "integration_not_ready") {
    return {
      ok: false,
      status: 403,
      code: row.result_status,
      message: "This integration is not ready for runtime traffic.",
    };
  }

  if (row.result_status === "make_money_not_active") {
    return {
      ok: false,
      status: 403,
      code: row.result_status,
      message: "Runtime traffic is not enabled for this workspace.",
    };
  }

  if (
    row.result_status !== "ok" ||
    !row.result_integration_id ||
    !row.result_product_id ||
    !row.result_workspace_id
  ) {
    return {
      ok: false,
      status: 503,
      code: "runtime_unavailable",
      message: "Runtime authentication is temporarily unavailable.",
    };
  }

  return {
    ok: true,
    integration: {
      id: row.result_integration_id,
      productId: row.result_product_id,
      workspaceId: row.result_workspace_id,
    },
  };
}
