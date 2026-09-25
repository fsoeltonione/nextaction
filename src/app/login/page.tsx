"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useSearchParams, useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const searchParams = useSearchParams();
  const router = useRouter();
  const pendingUrl = searchParams.get('pending_url');
  const authError = searchParams.get('error');
  
  const supabase = createClient();

  // If already logged in, redirect to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        if (pendingUrl) {
          router.push(`/onboarding?domain=${encodeURIComponent(pendingUrl)}`);
        } else {
          router.push('/dashboard');
        }
      } else {
        setChecking(false);
      }
    });
  }, [router, supabase, pendingUrl]);

  if (checking) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    
    const redirectTo = new URL(`${window.location.origin}/auth/callback`);
    if (pendingUrl) {
      redirectTo.searchParams.set('next', `/onboarding?domain=${encodeURIComponent(pendingUrl)}`);
    } else {
      redirectTo.searchParams.set('next', '/onboarding');
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-white text-center mb-2">
          Welcome to NextAction
        </h2>
        <p className="text-neutral-400 text-center mb-8">
          Sign in to analyze and monetize your SaaS.
        </p>

        {(error || authError) && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error || "Authentication failed. Please try again."}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-900 rounded-xl py-3.5 font-bold transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
        </button>
      </div>
    </div>
  );
}
