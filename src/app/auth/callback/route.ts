import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { safeInternalRedirect } from "@/lib/redirect";
import { createRequestId } from "@/lib/http";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalRedirect(
    requestUrl.searchParams.get("next"),
    "/dashboard",
  );

  if (!code) {
    const errorUrl = new URL("/login", requestUrl.origin);
    errorUrl.searchParams.set("error", "auth_failed");
    errorUrl.searchParams.set("request_id", requestId);
    return NextResponse.redirect(errorUrl);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const redirectUrl = new URL(next, requestUrl.origin);
      return NextResponse.redirect(redirectUrl);
    }
  } catch (error) {
    console.error("Auth callback failed", { requestId, error });
  }

  const errorUrl = new URL("/login", requestUrl.origin);
  errorUrl.searchParams.set("error", "auth_failed");
  errorUrl.searchParams.set("request_id", requestId);

  return NextResponse.redirect(errorUrl);
}
