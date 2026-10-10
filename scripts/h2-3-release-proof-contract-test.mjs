import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  healthRoute,
  deploy,
  staging,
  production,
  releaseProof,
  migration,
  releaseWorkflow,
  qualityGatesWorkflow,
  packageJson,
  settlementMigration,
  finalRuntimeMigration,
] = await Promise.all([
  readFile("src/app/api/health/route.ts", "utf8"),
  readFile("scripts/deploy-cloudflare.mjs", "utf8"),
  readFile("scripts/staging-smoke.mjs", "utf8"),
  readFile("scripts/production-smoke.mjs", "utf8"),
  readFile("scripts/production-release-proof.mjs", "utf8"),
  readFile(
    "supabase/migrations/20261004030000_h2_3_release_reliability_proof.sql",
    "utf8",
  ),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile(".github/workflows/quality-gates.yml", "utf8"),
  readFile("package.json", "utf8"),
  readFile("supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql", "utf8"),
  readFile("supabase/migrations/20261003020000_stage_17_final_reconcile.sql", "utf8"),
]);

// H2.3 release provenance: the deployed runtime must expose the build SHA,
// and both staging and production release smoke must compare it with the CI
// source revision.
assert.match(healthRoute, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(healthRoute, /release_sha: releaseSha/);
assert.match(deploy, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(
  deploy,
  /process\.env\.GITHUB_ACTIONS === "true"[\s\S]*process\.env\.GITHUB_SHA \|\| ""/,
  "GitHub Actions must supply the release provenance SHA",
);
assert.doesNotMatch(
  deploy,
  /CIRCLECI|CIRCLE_BRANCH|CIRCLE_SHA1/,
  "retired CircleCI metadata must not remain in the deployment path",
);
assert.match(deploy, /valid 40-character release SHA/);
assert.match(staging, /STAGING_EXPECTED_RELEASE_SHA/);
assert.match(staging, /healthBody\?\.release_sha !== expectedReleaseSha/);
assert.match(production, /PRODUCTION_EXPECTED_RELEASE_SHA/);
assert.match(production, /healthBody\?\.release_sha !== expectedReleaseSha/);

// MVP economics/replay acceptance must exercise concurrent public Clicks and
// repeated service-boundary settlement calls in both staging and production.
for (const smoke of [staging, production]) {
  assert.match(smoke, /CLICK_REPLAY_CONCURRENCY = 6/);
  assert.match(smoke, /SETTLEMENT_REPLAY_CONCURRENCY = 4/);
  assert.match(smoke, /runtime_click_qualify_and_settle/);
  assert.match(smoke, /result_click_id/);
  assert.match(smoke, /result_qualified_click_id/);
  assert.match(smoke, /result_settlement_id/);
  assert.match(smoke, /settlement_count/);
  assert.match(smoke, /financial_entry_count/);
  assert.match(smoke, /settlement_charge_cents/);
  assert.match(smoke, /publisher_share_cents/);
  assert.match(smoke, /platform_share_cents/);
  assert.match(smoke, /financial_debit_cents/);
  assert.match(smoke, /financial_credit_cents/);
  assert.match(smoke, /credit_consumption_entry_count/);
  assert.match(smoke, /economicState/);
}

// The database remains the final idempotency/atomicity boundary.
assert.match(settlementMigration, /FOR UPDATE OF qc/);
assert.match(settlementMigration, /FOR UPDATE/);
for (const requiredValue of ["'debit'", "'credit'", "100", "75", "25"]) {
  assert.ok(settlementMigration.includes(requiredValue), `settlement migration must encode ${requiredValue}`);
}
assert.match(settlementMigration, /available_units = available_units - 1/);
assert.match(settlementMigration, /financial_entries_settlement_account_uq/);
assert.ok(finalRuntimeMigration.includes("settlements_qualified_click_id_key"));
assert.ok(finalRuntimeMigration.includes("UNIQUE (qualified_click_id)"));
assert.match(finalRuntimeMigration, /runtime_click_qualify_and_settle/);
assert.match(finalRuntimeMigration, /runtime_record_and_qualify_click/);
assert.match(finalRuntimeMigration, /runtime_settle_qualified_click/);

console.log("H2.3 release proof contract: OK");
