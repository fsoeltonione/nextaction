import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { safeInternalRedirect } from "@/lib/redirect";
import { createRequestId } from "@/lib/http";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const safeNext = safeInternalRedirect(requestUrl.searchParams.get("next"), "/dashboard");
  const pendingUrl = new URL(safeNext, requestUrl.origin).searchParams.get("url");

  function authFailure() {
    const errorUrl = new URL("/login", requestUrl.origin);
    if (pendingUrl) errorUrl.searchParams.set("url", pendingUrl);
    errorUrl.searchParams.set("error", "auth_failed");
    errorUrl.searchParams.set("request_id", requestId);
    return NextResponse.redirect(errorUrl);
  }

  if (!code) return authFailure();

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
    }
  } catch (error) {
    console.error("Auth callback failed", { requestId, error });
  }

  return authFailure();
}
