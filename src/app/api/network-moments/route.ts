import { createClient } from "@/utils/supabase/server";
import { createRequestId, jsonError, jsonSuccess } from "@/lib/http";

export async function GET() {
  const requestId = createRequestId();

  try {
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

    const { data, error } = await supabase
      .from("network_moments")
      .select("key, label, description, status")
      .eq("status", "active")
      .order("key", { ascending: true });

    if (error) {
      console.error("Network Moment catalog fetch failed", {
        requestId,
        code: error.code,
      });
      return jsonError(
        requestId,
        500,
        "network_moment_catalog_failed",
        "Unable to load Network Moments.",
      );
    }

    return jsonSuccess(
      {
        network_moments: data ?? [],
      },
      requestId,
    );
  } catch (error) {
    console.error("Network Moment catalog route failed", {
      requestId,
      error,
    });
    return jsonError(
      requestId,
      500,
      "network_moment_catalog_failed",
      "Unable to load Network Moments.",
    );
  }
}
