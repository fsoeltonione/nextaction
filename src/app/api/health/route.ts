import { NextResponse } from "next/server";

export function GET() {
  const runtimeEnvironment = process.env.APP_ENV;

  const response = NextResponse.json({
    status: "ok",
    service: "nextaction",
    // Deployment identity is build-time and target-specific. Runtime APP_ENV
    // is reported separately so health verification does not depend on the
    // Workers process.env shim.
    environment:
      process.env.NEXT_PUBLIC_APP_ENV ?? runtimeEnvironment ?? "unknown",
    runtime_environment_configured: Boolean(runtimeEnvironment),
  });

  response.headers.set("Cache-Control", "no-store");
  return response;
}
