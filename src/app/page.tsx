"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ArrowRight, Sparkles, Globe } from "lucide-react";

export default function Home() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [url, setUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [isValidDomain, setIsValidDomain] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  // Logged-in users never see the landing page
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/dashboard');
      } else {
        setSessionChecked(true);
      }
    });
  }, [router, supabase]);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUrl(value);
    try {
      let parsed = value;
      if (!parsed.startsWith('http://') && !parsed.startsWith('https://')) {
        parsed = 'https://' + parsed;
      }
      const obj = new URL(parsed);
      if (obj.hostname.includes('.') && obj.hostname.length > 3) {
        setIsValidDomain(true);
        setDomain(obj.hostname);
        return;
      }
    } catch {}
    setIsValidDomain(false);
    setDomain("");
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDomain) return;
    setIsAnalyzing(true);
    // Not logged in → go to login with pending URL
    window.location.href = `/login?pending_url=${encodeURIComponent(domain)}`;
  };

  if (!sessionChecked) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 selection:bg-indigo-500/30">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          NextAction
        </div>
        <div className="flex items-center gap-6 text-sm font-medium">
          <a href="#" className="text-neutral-400 hover:text-neutral-50 transition-colors">How it works</a>
          <a href="#" className="text-neutral-400 hover:text-neutral-50 transition-colors">Pricing</a>
          <a href="/login" className="px-4 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors">
            Log in
          </a>
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 pt-32 pb-24 max-w-5xl mx-auto text-center">
        <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-8 duration-700">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
            Monetize your SaaS Moments.
          </h1>
          <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto">
            Discover commercial opportunities inside your product. Turn semantic events into revenue without intrusive ad-tech.
          </p>
        </div>

        <div className="w-full max-w-md mt-12 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both">
          <form onSubmit={handleAnalyze} className="relative group flex flex-col gap-3">
            <div className="relative flex items-center">
              {isValidDomain ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=64`}
                  alt="Favicon"
                  className="absolute left-4 w-5 h-5 rounded-sm"
                />
              ) : (
                <Globe className="absolute left-4 w-5 h-5 text-neutral-500 group-focus-within:text-indigo-400 transition-colors" />
              )}
              <input
                type="text"
                required
                placeholder="your-saas.com"
                value={url}
                onChange={handleUrlChange}
                disabled={isAnalyzing}
                className={`w-full bg-neutral-900 border ${url.length > 3 && !isValidDomain ? 'border-red-500/80 text-red-100' : 'border-neutral-800 text-neutral-100'} focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl py-4 pl-12 pr-4 placeholder:text-neutral-600 transition-all outline-none disabled:opacity-50`}
              />
            </div>
            {url.length > 3 && !isValidDomain && (
              <span className="text-red-400 text-sm text-left pl-2">Please enter a valid domain (e.g. datafa.st)</span>
            )}
            <button
              type="submit"
              disabled={isAnalyzing || !isValidDomain}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl py-4 font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              {isAnalyzing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing you in...
                </>
              ) : (
                <>Analyze my product <ArrowRight className="w-5 h-5" /></>
              )}
            </button>
            <p className="text-sm text-neutral-500 mt-2">No credit card required. Free analysis.</p>
          </form>
        </div>
      </main>
    </div>
  );
}
