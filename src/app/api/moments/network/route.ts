import { createClient } from "@/utils/supabase/server";
import {
  createRequestId,
  HttpError,
  isRecord,
  jsonError,
  jsonSuccess,
  readJsonBody,
} from "@/lib/http";

const NETWORK_MOMENT_KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = await readJsonBody(request);

    if (!isRecord(body)) {
      throw new HttpError(
        400,
        "invalid_payload",
        "Invalid Network Moment mapping payload.",
      );
    }

    const momentId =
      typeof body.moment_id === "string" ? body.moment_id.trim() : "";

    if (!UUID_RE.test(momentId)) {
      throw new HttpError(
        400,
        "invalid_moment_id",
        "A valid Moment id is required.",
      );
    }

    let networkMomentKey: string | null = null;

    if (body.network_moment_key !== null && body.network_moment_key !== undefined) {
      if (typeof body.network_moment_key !== "string") {
        throw new HttpError(
          400,
          "invalid_network_moment_key",
          "Network Moment key must be a string or null.",
        );
      }

      networkMomentKey = body.network_moment_key.trim().toLowerCase();

      if (
        !NETWORK_MOMENT_KEY_RE.test(networkMomentKey) ||
        networkMomentKey.length > 100
      ) {
        throw new HttpError(
          400,
          "invalid_network_moment_key",
          "Network Moment key is invalid.",
        );
      }
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

    const { data, error } = await supabase.rpc(
      "set_moment_network_mapping_v1",
      {
        p_moment_id: momentId,
        p_network_moment_key: networkMomentKey,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return jsonError(
          requestId,
          403,
          "not_authorized",
          "You are not authorized to change this Moment mapping.",
        );
      }

      if (error.code === "P0002") {
        return jsonError(
          requestId,
          404,
          "moment_not_found",
          "The requested Moment was not found.",
        );
      }

      if (error.code === "22023") {
        return jsonError(
          requestId,
          400,
          "invalid_network_moment_mapping",
          "The Network Moment mapping is invalid.",
        );
      }

      console.error("Moment Network Moment mapping failed", {
        requestId,
        code: error.code,
      });

      return jsonError(
        requestId,
        500,
        "network_moment_mapping_failed",
        "Unable to update the Network Moment mapping.",
      );
    }

    const result = Array.isArray(data) ? data[0] : data;

    return jsonSuccess(
      {
        mapping: {
          moment_id: result?.result_moment_id ?? momentId,
          network_moment_id: result?.result_network_moment_id ?? null,
          network_moment_key: result?.result_network_moment_key ?? null,
        },
      },
      requestId,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(
        requestId,
        error.status,
        error.code,
        error.message,
      );
    }

    console.error("Moment Network Moment route failed", {
      requestId,
      error,
    });

    return jsonError(
      requestId,
      500,
      "network_moment_mapping_failed",
      "Unable to update the Network Moment mapping.",
    );
  }
}
