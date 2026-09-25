"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Sparkles, Globe, ArrowRight, LogOut } from "lucide-react";

export default function OnboardingPage() {
  const [user, setUser] = useState<any>(null);
  const [url, setUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [isValidDomain, setIsValidDomain] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [step, setStep] = useState<'input' | 'analyzing' | 'result'>('input');
  const [result, setResult] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hasFetched = useRef(false);

  const supabase = createClient();
  const router = useRouter();

  // Auth guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.push('/login');
      } else {
        setUser(data.session.user);
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
    setStep('analyzing');
    hasFetched.current = false;
  };

  // Trigger analysis when step changes to 'analyzing'
  useEffect(() => {
    if (step !== 'analyzing' || hasFetched.current) return;
    hasFetched.current = true;

    async function fetchAnalysis() {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        setStep('result');
      } else {
        setStep('input');
        setIsAnalyzing(false);
      }
    }
    fetchAnalysis();
  }, [step, domain]);

  const handleSave = async (intent: 'monetize' | 'advertise') => {
    if (!result) return;
    setIsSaving(true);
    const res = await fetch('/api/products/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name: result.name, description: result.description, moments: result.moments, intent })
    });
    if (res.ok) {
      router.push(`/dashboard?intent=${intent}`);
    } else {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (!user) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-7xl mx-auto border-b border-neutral-900">
        <a href="/dashboard" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          NextAction
        </a>
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-sm text-neutral-400 hover:text-white transition-colors">← Back to Dashboard</a>
          <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-red-400 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 py-20 max-w-3xl mx-auto">

        {/* ===== STEP: INPUT ===== */}
        {step === 'input' && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-8 duration-500">
            <div className="text-center mb-12">
              <p className="text-indigo-400 text-sm font-medium mb-3 tracking-wider uppercase">Add a Product</p>
              <h1 className="text-4xl font-extrabold text-white mb-3">What's your SaaS URL?</h1>
              <p className="text-neutral-400">We'll analyze the product and detect its commercial moments.</p>
            </div>
            <form onSubmit={handleAnalyze} className="flex flex-col gap-4 max-w-md mx-auto">
              <div className="relative group flex items-center">
                {isValidDomain ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=64`} alt="" className="absolute left-4 w-5 h-5 rounded-sm" />
                ) : (
                  <Globe className="absolute left-4 w-5 h-5 text-neutral-500 group-focus-within:text-indigo-400 transition-colors" />
                )}
                <input
                  type="text"
                  required
                  placeholder="your-saas.com"
                  value={url}
                  onChange={handleUrlChange}
                  className={`w-full bg-neutral-900 border ${url.length > 3 && !isValidDomain ? 'border-red-500/80 text-red-100' : 'border-neutral-800 text-neutral-100'} focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl py-4 pl-12 pr-4 placeholder:text-neutral-600 transition-all outline-none`}
                />
              </div>
              {url.length > 3 && !isValidDomain && (
                <span className="text-red-400 text-sm pl-2">Please enter a valid domain (e.g. datafa.st)</span>
              )}
              <button
                type="submit"
                disabled={!isValidDomain}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl py-4 font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
              >
                Analyze product <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          </div>
        )}

        {/* ===== STEP: ANALYZING ===== */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full animate-pulse" />
              <div className="w-16 h-16 bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center justify-center relative z-10">
                <Sparkles className="w-8 h-8 text-indigo-400 animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold text-white">Analyzing {domain}...</h2>
              <p className="text-neutral-500 text-sm max-w-xs">Our AI is exploring the product to detect valuable commercial moments.</p>
            </div>
          </div>
        )}

        {/* ===== STEP: RESULT ===== */}
        {step === 'result' && result && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-8 duration-500">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 text-left space-y-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-full blur-[100px] -mr-16 -mt-16 pointer-events-none" />

              <div className="relative z-10 space-y-2">
                <div className="flex items-center gap-2 text-indigo-400 font-medium mb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=64`} alt="" className="w-5 h-5 rounded-sm" />
                  <span className="text-sm">Analysis Complete for {domain}</span>
                </div>
                <h2 className="text-2xl font-bold text-white">{result.name}</h2>
                <p className="text-neutral-400 text-sm">{result.description}</p>
              </div>

              <div className="relative z-10 space-y-3">
                <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Detected Commercial Moments</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {result.moments?.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800/50 rounded-xl">
                      <span className="text-sm font-medium text-neutral-200">{m.label}</span>
                      <span className="text-xs font-mono text-neutral-500 px-2 py-0.5 bg-neutral-900 rounded">{m.id}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative z-10 pt-4 border-t border-neutral-800 space-y-3">
                <h3 className="text-center text-base font-medium text-neutral-300">What is your primary goal?</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <button
                    onClick={() => handleSave('monetize')}
                    disabled={isSaving}
                    className="flex flex-col items-center p-5 bg-neutral-950 border border-neutral-800 rounded-2xl hover:border-indigo-500 hover:bg-indigo-500/5 transition-all group disabled:opacity-50"
                  >
                    <span className="text-lg font-bold text-white mb-1 group-hover:text-indigo-400">Make Money</span>
                    <span className="text-xs text-neutral-500">Monetize these moments in my app</span>
                  </button>
                  <button
                    onClick={() => handleSave('advertise')}
                    disabled={isSaving}
                    className="flex flex-col items-center p-5 bg-neutral-950 border border-neutral-800 rounded-2xl hover:border-indigo-500 hover:bg-indigo-500/5 transition-all group disabled:opacity-50"
                  >
                    <span className="text-lg font-bold text-white mb-1 group-hover:text-indigo-400">Reach Customers</span>
                    <span className="text-xs text-neutral-500">Target these moments in other apps</span>
                  </button>
                </div>
                {isSaving && <p className="text-center text-sm text-indigo-400 animate-pulse">Saving...</p>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
