import "server-only";

import { env as cloudflareEnv } from "cloudflare:workers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type RuntimeBindings = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function getRuntimeBindings(): RuntimeBindings {
  const processBindings: RuntimeBindings = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const workerBindings = cloudflareEnv as RuntimeBindings;

  return {
    ...processBindings,
    ...workerBindings,
  };
}

export function createAdminClient() {
  const bindings = getRuntimeBindings();
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
