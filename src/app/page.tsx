"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Sparkles } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { normalizeProductUrl } from "@/lib/url";

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [url, setUrl] = useState("");
  const [hostname, setHostname] = useState("");
  const [isValidUrl, setIsValidUrl] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      if (data.session) {
        const current = new URL(window.location.href);
        const pendingUrl = current.searchParams.get("url");

        if (pendingUrl) {
          router.replace("/onboarding?url=" + encodeURIComponent(pendingUrl));
        } else {
          router.replace("/dashboard");
        }
      } else {
        setSessionChecked(true);
      }
    });

    return () => {
      active = false;
    };
  }, [router, supabase]);

  function handleUrlChange(value: string) {
    setUrl(value);

    try {
      const normalized = normalizeProductUrl(value);
      setHostname(normalized.hostname);
      setIsValidUrl(true);
    } catch {
      setHostname("");
      setIsValidUrl(false);
    }
  }

  function handleContinue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidUrl || isContinuing) return;

    try {
      const normalized = normalizeProductUrl(url);
      setIsContinuing(true);
      router.push("/login?url=" + encodeURIComponent(normalized.value));
    } catch {
      setIsValidUrl(false);
    }
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 selection:bg-indigo-500/30">
      <nav className="flex items-center justify-between px-6 py-5 md:px-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          NextAction
        </div>
        <a
          href="/login"
          className="px-4 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors text-sm font-medium"
        >
          Log in
        </a>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 pt-28 pb-24 max-w-5xl mx-auto text-center">
        <div className="space-y-6 max-w-3xl">
          <p className="text-indigo-400 text-sm font-semibold tracking-[0.18em] uppercase">
            Contextual growth for SaaS
          </p>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
            Put your SaaS moments to work.
          </h1>
          <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto">
            Connect the moments that matter inside your product with relevant commercial opportunities.
          </p>
        </div>

        <div className="w-full max-w-xl mt-12">
          <form onSubmit={handleContinue} className="flex flex-col gap-3">
            <div className="relative flex items-center">
              {hostname ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={"https://s2.googleusercontent.com/s2/favicons?domain=" + hostname + "&sz=64"}
                  alt=""
                  className="absolute left-4 w-5 h-5 rounded-sm"
                />
              ) : (
                <Globe className="absolute left-4 w-5 h-5 text-neutral-500" />
              )}
              <input
                type="text"
                required
                value={url}
                onChange={(event) => handleUrlChange(event.target.value)}
                disabled={isContinuing}
                placeholder="https://your-saas.com"
                className={
                  "w-full bg-neutral-900 border rounded-2xl py-4 pl-12 pr-4 text-neutral-100 placeholder:text-neutral-600 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 " +
                  (url.length > 3 && !isValidUrl ? "border-red-500/70" : "border-neutral-800")
                }
              />
            </div>

            {url.length > 3 && !isValidUrl && (
              <p className="text-left pl-2 text-sm text-red-400">
                Enter a public HTTP or HTTPS SaaS URL.
              </p>
            )}

            <button
              type="submit"
              disabled={!isValidUrl || isContinuing}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl py-4 font-semibold transition-all disabled:opacity-50 disabled:hover:scale-100"
            >
              {isContinuing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Continuing...
                </>
              ) : (
                <>
                  Understand my product
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>

            <p className="text-sm text-neutral-500">
              Start with your URL. Sign-in is only required when we need to save your setup.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
