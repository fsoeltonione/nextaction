"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Code2, ArrowLeft, LogOut, User } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function AnalyzePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const domain = searchParams.get("domain") || "your-saas.com";
  
  const [result, setResult] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const hasFetched = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push(`/login?pending_url=${encodeURIComponent(domain)}`);
      } else {
        setUser(session.user);
      }
    }
    checkAuth();
  }, [router, domain, supabase]);

  const handleSave = async (intent: 'monetize' | 'advertise') => {
    if (!result) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/products/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          name: result.name,
          description: result.description,
          moments: result.moments,
          intent
        })
      });

      if (res.ok) {
        router.push(`/dashboard?intent=${intent}`);
      } else {
        const errText = await res.text();
        console.error("Failed to save", errText);
        alert(`Failed to save: ${errText}`);
        setIsSaving(false);
      }
    } catch (err) {
      console.error(err);
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    async function fetchAnalysis() {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain })
        });
        
        if (res.ok) {
          const data = await res.json();
          setResult(data);
        } else {
          const errText = await res.text();
          console.error(`Analysis failed with status ${res.status}:`, errText);
          setResult({
            name: domain,
            description: `Error: ${res.status} - ${errText}`,
            moments: []
          });
        }
      } catch (err) {
        console.error(err);
      }
    }
    
    fetchAnalysis();
  }, [domain]);

  if (!result || !user) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full animate-pulse" />
            <div className="w-16 h-16 bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center justify-center relative z-10">
              <Sparkles className="w-8 h-8 text-indigo-400 animate-pulse" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-white">Analyzing {domain}...</h2>
            <p className="text-neutral-500 text-sm max-w-xs">Our AI is exploring the product to discover valuable commercial moments.</p>
          </div>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 selection:bg-indigo-500/30">
      <nav className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto border-b border-neutral-900">
        <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <User className="w-4 h-4" />
            <span>{user?.email}</span>
          </div>
          <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-red-400 transition-colors flex items-center gap-1">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 pt-12 pb-24 max-w-5xl mx-auto">
        <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 text-left space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-full blur-[100px] -mr-16 -mt-16 pointer-events-none" />
            
            <div className="space-y-2 relative z-10">
              <div className="flex items-center gap-2 text-indigo-400 font-medium mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=64`} 
                  alt="Favicon"
                  className="w-5 h-5 rounded-sm"
                />
                <span>Analysis Complete for {domain}</span>
              </div>
              <h2 className="text-3xl font-bold text-white">{result.name}</h2>
              <p className="text-neutral-400">{result.description}</p>
            </div>

            <div className="space-y-4 relative z-10">
              <h3 className="text-lg font-medium text-neutral-200 border-b border-neutral-800 pb-2">
                Detected Commercial Moments
              </h3>
              <div className="grid gap-3">
                {result.moments.map((moment: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-neutral-950 border border-neutral-800/50 rounded-xl hover:border-indigo-500/30 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-neutral-900 rounded-lg text-neutral-400 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors">
                        <Code2 className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-neutral-200">{moment.label}</span>
                    </div>
                    <span className="text-xs font-mono text-neutral-500 px-2 py-1 bg-neutral-900 rounded">{moment.id}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-neutral-800 space-y-4 relative z-10">
              <h3 className="text-center text-lg font-medium text-neutral-300 mb-6">What is your primary goal?</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <button 
                  onClick={() => handleSave('monetize')}
                  disabled={isSaving}
                  className="flex flex-col items-center p-6 bg-neutral-950 border border-neutral-800 rounded-2xl hover:border-indigo-500 hover:bg-indigo-500/5 transition-all group text-center cursor-pointer disabled:opacity-50"
                >
                  <span className="text-xl font-bold text-white mb-2 group-hover:text-indigo-400">Make Money</span>
                  <span className="text-sm text-neutral-500">Monetize these moments in my app</span>
                </button>
                <button 
                  onClick={() => handleSave('advertise')}
                  disabled={isSaving}
                  className="flex flex-col items-center p-6 bg-neutral-950 border border-neutral-800 rounded-2xl hover:border-indigo-500 hover:bg-indigo-500/5 transition-all group text-center cursor-pointer disabled:opacity-50"
                >
                  <span className="text-xl font-bold text-white mb-2 group-hover:text-indigo-400">Reach Customers</span>
                  <span className="text-sm text-neutral-500">Target these moments in other apps</span>
                </button>
              </div>
              {isSaving && <p className="text-center text-sm text-indigo-400 mt-4 animate-pulse">Saving your product...</p>}
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
