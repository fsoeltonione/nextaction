import { NextResponse } from "next/server";

export const RUNTIME_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export function withRuntimeCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(RUNTIME_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function runtimeOptionsResponse(): NextResponse {
  return withRuntimeCors(new NextResponse(null, { status: 204 }));
}

export function getRequestIp(request: Request): string {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}
