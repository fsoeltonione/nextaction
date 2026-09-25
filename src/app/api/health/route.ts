import { NextResponse } from "next/server";

export function GET() {
  const response = NextResponse.json({
    status: "ok",
    service: "nextaction",
    environment: process.env.APP_ENV ?? "unknown",
  });

  response.headers.set("Cache-Control", "no-store");
  return response;
}
