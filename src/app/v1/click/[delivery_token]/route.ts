import { NextResponse } from "next/server";
import { createRequestId, jsonError } from "@/lib/http";
import { sha256Hex } from "@/lib/credentials";
import { getRequestIp } from "@/lib/runtime/http";
import { checkRateLimit } from "@/lib/runtime/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

const MAX_TOKEN_LENGTH = 256;
const CLICK_RATE_LIMIT_PER_MINUTE = 120;

type ClickResult = {
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
};

function failure(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  const response = jsonError(requestId, status, code, message);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}

function rateLimited(requestId: string, retryAfterSeconds: number) {
  const response = failure(
    requestId,
    429,
    "rate_limited",
    "Too many requests. Please retry later.",
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

function redirectToDestination(requestId: string, destinationUrl: string) {
  let destination: URL;

  try {
    destination = new URL(destinationUrl);
  } catch {
    return failure(
      requestId,
      503,
      "destination_unavailable",
      "The offer destination is temporarily unavailable.",
    );
  }

  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return failure(
      requestId,
      503,
      "destination_unavailable",
      "The offer destination is temporarily unavailable.",
    );
  }

  const response = NextResponse.redirect(destination, 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ delivery_token: string }> },
) {
  const requestId = createRequestId();

  try {
    const rateLimit = await checkRateLimit(
      "runtime:click:ip",
      getRequestIp(request),
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

    const { data, error } = await admin.rpc("runtime_record_click", {
      p_delivery_token_hash: deliveryTokenHash,
    });

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

    const row = (Array.isArray(data) ? data[0] : data) as ClickResult | null;

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
