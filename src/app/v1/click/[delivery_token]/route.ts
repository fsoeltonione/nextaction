import { NextResponse } from "next/server";
import { createRequestId, jsonError } from "@/lib/http";
import { sha256Hex } from "@/lib/credentials";
import { getRequestIp } from "@/lib/runtime/http";
import { checkRateLimit } from "@/lib/runtime/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

const MAX_TOKEN_LENGTH = 256;
const CLICK_RATE_LIMIT_PER_MINUTE = 120;

type ClickQualifySettleResult = {
  result_outcome:
    | "created"
    | "replayed"
    | "not_found"
    | "expired"
    | "destination_unavailable";
  result_click_id: string | null;
  result_qualification_status: string | null;
  result_destination_url: string | null;
  result_reason_code: string | null;
  result_qualified_click_id: string | null;
  result_qualification_version: string | null;
  result_qualified_at: string | null;
  result_settlement_outcome:
    | "settled"
    | "replayed"
    | "not_found"
    | "not_qualified"
    | "no_capacity"
    | "financial_unavailable"
    | null;
  result_settlement_id: string | null;
  result_advertiser_workspace_id: string | null;
  result_publisher_workspace_id: string | null;
  result_charge_cents: number | null;
  result_publisher_share_cents: number | null;
  result_platform_share_cents: number | null;
  result_currency: string | null;
  result_remaining_capacity: number | null;
  result_settlement_reason_code: string | null;
};

function failure(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return jsonError(requestId, status, code, message);
}

function rateLimited(requestId: string, retryAfterSeconds: number) {
  return new NextResponse(
    JSON.stringify({
      error: {
        request_id: requestId,
        code: "rate_limited",
        message: "Too many requests. Please try again later.",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

function redirectToDestination(requestId: string, url: string) {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store, max-age=0",
      "X-NextAction-Request-Id": requestId,
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ delivery_token: string }> },
) {
  const requestId = createRequestId();

  try {
    const ip = getRequestIp(request);
    const rateLimit = await checkRateLimit(
      "click_ip",
      ip,
      CLICK_RATE_LIMIT_PER_MINUTE,
    );

    if (!rateLimit.allowed) {
      return rateLimited(requestId, rateLimit.retry_after_seconds);
    }

    const { delivery_token: deliveryToken } = await params;

    if (
      typeof deliveryToken !== "string" ||
      deliveryToken.length < 20 ||
      deliveryToken.length > MAX_TOKEN_LENGTH
    ) {
      return failure(
        requestId,
        404,
        "delivery_not_found",
        "The delivery could not be found.",
      );
    }

    const deliveryTokenHash = await sha256Hex(deliveryToken);
    const admin = createAdminClient();

    const { data, error } = await admin.rpc(
      "runtime_click_qualify_and_settle",
      {
        p_delivery_token_hash: deliveryTokenHash,
      },
    );

    if (error) {
      if (error.code === "22023") {
        return failure(
          requestId,
          400,
          "invalid_delivery_token",
          "The delivery token is invalid.",
        );
      }

      console.error("Runtime click processing failed", {
        requestId,
        code: error.code,
      });

      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Click processing is temporarily unavailable.",
      );
    }

    const row = (Array.isArray(data) ? data[0] : data) as ClickQualifySettleResult | null;

    if (!row) {
      return failure(
        requestId,
        503,
        "runtime_unavailable",
        "Click processing is temporarily unavailable.",
      );
    }

    if (row.result_outcome === "not_found") {
      return failure(
        requestId,
        404,
        "delivery_not_found",
        "The delivery could not be found.",
      );
    }

    if (row.result_outcome === "expired") {
      return failure(
        requestId,
        404,
        "delivery_expired",
        "The delivery has expired.",
      );
    }

    if (
      row.result_outcome !== "created" &&
      row.result_outcome !== "replayed"
    ) {
      return failure(
        requestId,
        503,
        "destination_unavailable",
        "The offer destination is temporarily unavailable.",
      );
    }

    if (!row.result_destination_url) {
      return failure(
        requestId,
        503,
        "destination_unavailable",
        "The offer destination is temporarily unavailable.",
      );
    }

    if (!row.result_qualified_click_id) {
      return failure(
        requestId,
        503,
        "settlement_unavailable",
        "The qualified click could not be settled.",
      );
    }

    if (
      row.result_settlement_outcome === "not_found" ||
      row.result_settlement_outcome === "not_qualified"
    ) {
      return failure(
        requestId,
        409,
        "settlement_not_eligible",
        "The qualified click is not eligible for settlement.",
      );
    }

    if (
      row.result_settlement_outcome === "no_capacity" ||
      row.result_settlement_outcome === "financial_unavailable"
    ) {
      return failure(
        requestId,
        503,
        "settlement_unavailable",
        "Click settlement is temporarily unavailable.",
      );
    }

    if (
      row.result_settlement_outcome !== "settled" &&
      row.result_settlement_outcome !== "replayed"
    ) {
      return failure(
        requestId,
        503,
        "settlement_unavailable",
        "Click settlement is temporarily unavailable.",
      );
    }

    return redirectToDestination(requestId, row.result_destination_url);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Rate limit service unavailable."
    ) {
      return failure(
        requestId,
        503,
        "rate_limit_unavailable",
        "Runtime protection is temporarily unavailable.",
      );
    }

    console.error("Runtime click route failed", {
      requestId,
      error,
    });

    return failure(
      requestId,
      500,
      "runtime_error",
      "Unable to process the click.",
    );
  }
}
