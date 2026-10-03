import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  migration,
  validationMigration,
  offerRoute,
  catalogRoute,
  mappingRoute,
  databaseTypes,
  packageJson,
] = await Promise.all([
  readFile(
    "supabase/migrations/20261004034037_h3_1_network_moment_model.sql",
    "utf8",
  ),
  readFile(
    "supabase/migrations/20261004040300_h3_1_network_offer_validation.sql",
    "utf8",
  ),
  readFile("src/app/api/offers/create/route.ts", "utf8"),
  readFile("src/app/api/network-moments/route.ts", "utf8"),
  readFile("src/app/api/moments/network/route.ts", "utf8"),
  readFile("src/lib/database.types.ts", "utf8"),
  readFile("package.json", "utf8"),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.network_moments/);
assert.match(migration, /network_moments_key_check/);
assert.match(migration, /network_moments_status_check/);
assert.match(migration, /ALTER TABLE public\.network_moments ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE public\.network_moments FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT SELECT ON TABLE public\.network_moments TO authenticated/);
assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.network_moments TO service_role/);

assert.match(migration, /ADD COLUMN IF NOT EXISTS network_moment_id UUID/);
assert.match(migration, /moments_network_moment_id_fkey/);
assert.match(migration, /REFERENCES public\.network_moments\(id\)/);
assert.match(migration, /ON DELETE SET NULL/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.offer_network_moments/);
assert.match(migration, /offer_network_moments_pkey/);
assert.match(migration, /offer_network_moments_offer_id_fkey/);
assert.match(migration, /offer_network_moments_network_moment_id_fkey/);
assert.match(migration, /ALTER TABLE public\.offer_network_moments ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE public\.offer_network_moments FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.offer_network_moments TO service_role/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_moment_network_mapping_v1/);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path = ''/);
assert.match(migration, /auth\.uid\(\)/);
assert.match(migration, /workspace not authorized/);
assert.match(migration, /network moment is not available/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_network_offer_activation_v1/);
assert.match(migration, /p_network_moment_keys TEXT\[\]/);
assert.match(migration, /reach_customers/);
assert.match(migration, /network_moments.*status = 'active'/s);
assert.match(
  validationMigration,
  /RAISE EXCEPTION 'one or more target network moments are not available' USING ERRCODE = '22023'/,
);

assert.match(migration, /H3\.1 runtime resolution: Network Moment first, legacy fallback second/);
assert.match(migration, /FROM public\.offer_network_moments/);
assert.match(migration, /onm\.network_moment_id = v_network_moment_id/);
assert.match(migration, /FROM public\.offer_moments/);
assert.match(migration, /om\.moment_id = v_moment_id/);
assert.match(migration, /ORDER BY o\.created_at DESC, o\.id/);
assert.doesNotMatch(migration, /spent_cents\s*=/);
assert.doesNotMatch(migration, /budget_cents\s*=/);
assert.doesNotMatch(migration, /rank|score|frequency.?cap/i);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.runtime_h3_1_release_proof\(\)/);
assert.match(migration, /invalid_mapping_count/);
assert.match(migration, /inactive_target_count/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.runtime_h3_1_release_proof\(\)[\s\S]*TO service_role/);

assert.match(offerRoute, /network_moment_keys/);
assert.match(offerRoute, /must be an array/);
assert.match(offerRoute, /conflicting_offer_targets/);
assert.match(offerRoute, /create_network_offer_activation_v1/);
assert.match(offerRoute, /create_offer_activation_v2/);
assert.match(offerRoute, /cannot be combined with legacy Moment targets/);

assert.match(catalogRoute, /GET\(\)/);
assert.match(catalogRoute, /from\("network_moments"\)/);
assert.match(catalogRoute, /eq\("status", "active"\)/);
assert.match(catalogRoute, /Authentication is required/);

assert.match(mappingRoute, /POST\(request: Request\)/);
assert.match(mappingRoute, /set_moment_network_mapping_v1/);
assert.match(mappingRoute, /network_moment_key/);
assert.match(mappingRoute, /network_moment_key_required/);
assert.match(mappingRoute, /use null to remove a mapping/);
assert.match(mappingRoute, /42501/);
assert.match(mappingRoute, /P0002/);

assert.match(databaseTypes, /network_moments: \{/);
assert.match(databaseTypes, /offer_network_moments: \{/);
assert.match(databaseTypes, /network_moment_id: string \| null/);
assert.match(databaseTypes, /set_moment_network_mapping_v1: \{/);
assert.match(databaseTypes, /create_network_offer_activation_v1: \{/);
assert.match(databaseTypes, /runtime_h3_1_release_proof: \{/);

assert.equal(
  JSON.parse(packageJson).scripts["test:h3-1-network-moment"],
  "node scripts/h3-1-network-moment-contract-test.mjs",
);

console.log("H3.1 Network Moment contract: OK");
