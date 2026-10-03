import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const environment = (process.argv[2] ?? "staging").toLowerCase();
const config = {
  staging: {
    url: process.env.STAGING_NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.STAGING_SUPABASE_SECRET_KEY,
  },
  production: {
    url: process.env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.PRODUCTION_SUPABASE_SECRET_KEY,
  },
}[environment];

if (!config) {
  console.error("Usage: node scripts/h3-1-release-proof.mjs <staging|production>");
  process.exit(2);
}

if (!config.url || !config.key) {
  console.error(`Missing Supabase release-proof credentials for ${environment}.`);
  process.exit(2);
}

const supabase = createClient(config.url, config.key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.rpc("runtime_h3_1_release_proof");

if (error) {
  console.error("H3.1 release proof RPC failed.", error);
  process.exit(1);
}

const proof = Array.isArray(data) ? data[0] : data;

assert.equal(proof?.ready, true, "H3.1 release proof must be ready.");
assert.equal(proof?.schema_ready, true, "H3.1 schema proof must be ready.");
assert.equal(proof?.access_ready, true, "H3.1 access proof must be ready.");
assert.equal(proof?.runtime_ready, true, "H3.1 runtime proof must be ready.");
assert.equal(
  Number(proof?.invalid_mapping_count ?? -1),
  0,
  "H3.1 invalid mapping count must be zero.",
);
assert.equal(
  Number(proof?.inactive_target_count ?? -1),
  0,
  "H3.1 inactive target count must be zero.",
);

console.log(`H3.1 release proof: PASS (${environment})`);
