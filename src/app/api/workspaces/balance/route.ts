import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  createRequestId,
  HttpError,
  jsonError,
  jsonSuccess,
} from "@/lib/http";

export async function GET(request: Request) {
  const requestId = createRequestId();

  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id");

    if (!workspaceId) {
      throw new HttpError(
        400,
        "invalid_request",
        "workspace_id is required.",
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return jsonError(
        requestId,
        401,
        "unauthorized",
        "Authentication is required.",
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      console.error("Balance membership check failed", {
        requestId,
        code: membershipError.code,
      });
      return jsonError(
        requestId,
        500,
        "balance_fetch_failed",
        "Unable to verify workspace access.",
      );
    }

    if (!membership) {
      return jsonError(
        requestId,
        403,
        "not_authorized",
        "You are not authorized for this workspace.",
      );
    }

    const adminClient = createAdminClient();
    const { data: account, error } = await adminClient
      .schema("private")
      .from("advertiser_credit_accounts")
      .select("available_units")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      console.error("Balance fetch failed", {
        requestId,
        code: error.code,
      });
      return jsonError(
        requestId,
        500,
        "balance_fetch_failed",
        "Unable to fetch balance.",
      );
    }

    const availableUnits = account?.available_units ?? 0;
    const response = jsonSuccess(
      {
        balance: `$${availableUnits.toFixed(2)}`,
        currency: "USD",
        available_units: availableUnits,
      },
      requestId,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(requestId, error.status, error.code, error.message);
    }

    console.error("Balance route failed", { requestId, error });
    return jsonError(
      requestId,
      500,
      "balance_fetch_failed",
      "Unable to fetch balance.",
    );
  }
}
