import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/http";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET() {
  const requestId = createRequestId();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("runtime_readiness");

    if (error) {
      const response = NextResponse.json(
        {
          status: "not_ready",
          request_id: requestId,
        },
        { status: 503 },
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Request-Id", requestId);
      return response;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const status = row?.status === "ready" ? "ready" : "not_ready";

    const response = NextResponse.json(
      {
        ...row,
        request_id: requestId,
      },
      { status: status === "ready" ? 200 : 503 },
    );

    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error) {
    console.error("Runtime readiness check failed", { requestId, error });

    const response = NextResponse.json(
      {
        status: "not_ready",
        request_id: requestId,
      },
      { status: 503 },
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Request-Id", requestId);
    return response;
  }
}
