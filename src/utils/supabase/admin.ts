import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type RuntimeBindings = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

async function getRuntimeBindings(): Promise<RuntimeBindings> {
  const processBindings: RuntimeBindings = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    const cloudflareWorkers = await import("cloudflare:workers");
    const workerBindings = cloudflareWorkers.env as RuntimeBindings;

    return {
      ...processBindings,
      ...workerBindings,
    };
  } catch {
    return processBindings;
  }
}

export async function createAdminClient() {
  const bindings = await getRuntimeBindings();
  const url = bindings.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    bindings.SUPABASE_SECRET_KEY ?? bindings.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  return createSupabaseClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
