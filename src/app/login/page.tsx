"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

function LoginContent() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const router = useRouter();

  const pendingUrl = searchParams.get("url");
  const pendingWorkspaceId = searchParams.get("workspace_id");
  const pendingMode = searchParams.get("mode");
  const authError = searchParams.get("error");

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      if (data.session) {
        const target = pendingUrl
          ? "/onboarding?url=" + encodeURIComponent(pendingUrl) + (pendingWorkspaceId ? "&workspace_id=" + encodeURIComponent(pendingWorkspaceId) : "") + (pendingMode === "add_product" ? "&mode=add_product" : "")
          : "/dashboard";
        router.replace(target);
      } else {
        setChecking(false);
      }
    });

    return () => {
      active = false;
    };
  }, [pendingMode, pendingUrl, pendingWorkspaceId, router, supabase]);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);

    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set(
      "next",
      pendingUrl
        ? "/onboarding?url=" + encodeURIComponent(pendingUrl) + (pendingWorkspaceId ? "&workspace_id=" + encodeURIComponent(pendingWorkspaceId) : "") + (pendingMode === "add_product" ? "&mode=add_product" : "")
        : "/dashboard",
    );

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo.toString(),
      },
    });

    if (oauthError) {
      setError("Unable to start authentication. Please try again.");
      console.error("Google sign-in failed", oauthError);
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white text-center mb-2">
          Continue to NextAction
        </h1>
        <p className="text-neutral-400 text-center mb-8">
          Sign in to save your product understanding and finish activation.
        </p>

        {(error || authError) && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error || "Authentication failed. Please try again."}
          </div>
        )}

        {pendingUrl && (
          <div className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
              Product
            </p>
            <p className="text-sm text-neutral-200 break-all">{pendingUrl}</p>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-900 rounded-xl py-3.5 font-bold transition-all disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          <span>{loading ? "Connecting..." : "Continue with Google"}</span>
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
