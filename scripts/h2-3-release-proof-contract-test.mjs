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

// H2.3 database proof must be service-only and include the H2.1/H2.2
// migrations plus the final runtime lifecycle invariants.
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.runtime_release_proof\(\)/);
assert.match(migration, /runtime_integrity_audit\(\)/);
assert.match(migration, /private\.runtime_dead_letters/);
assert.match(migration, /private\.rate_limit_buckets/);
assert.match(migration, /h2_1_runtime_failure_containment/);
assert.match(migration, /h2_2_recovery_operations/);
assert.match(migration, /h2_2_runtime_ops_hardening/);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.runtime_release_proof\(\)[\s\S]*FROM PUBLIC, anon, authenticated/,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.runtime_release_proof\(\)[\s\S]*TO service_role/,
);

// The final proof must bind application provenance to the production DB proof.
assert.match(releaseProof, /PRODUCTION_EXPECTED_RELEASE_SHA/);
assert.match(releaseProof, /runtime_release_proof/);
assert.match(releaseProof, /release_sha !== expectedReleaseSha/);
assert.match(releaseProof, /dead_letter_count !== 0/);
assert.match(releaseProof, /stale_rate_limit_bucket_count !== 0/);
assert.match(releaseProof, /h2_3_release_reliability_proof !== true/);
assert.match(releaseProof, /Production release proof: PASS/);
assert.equal(
  JSON.parse(packageJson).scripts["production:release-proof"],
  "node scripts/production-release-proof.mjs",
);

// GitHub Actions release workflow must make the H2.3 contract a prerequisite
// for staging deployment and keep the final production proof behind the live
// production smoke.
const releaseWorkflowJobsStart = releaseWorkflow.indexOf("jobs:");
assert.notEqual(
  releaseWorkflowJobsStart,
  -1,
  "GitHub release workflow jobs section must exist",
);
const releaseJobs = releaseWorkflow.slice(releaseWorkflowJobsStart);

for (const job of [
  "release_source_guard",
  "quality_gates",
  "deploy_staging",
  "staging_smoke",
  "h3_1_staging_release_proof",
  "h3_1_staging_runtime_smoke",
  "hold_production",
  "deploy_production",
  "cloudflare_production_audit",
  "production_smoke",
  "h3_1_production_release_proof",
  "production_release_proof",
]) {
  assert.match(
    releaseJobs,
    new RegExp("^  " + job + ":", "m"),
    `${job} must exist in GitHub release workflow`,
  );
}

function jobBlock(job) {
  const start = releaseWorkflow.indexOf("\n  " + job + ":");
  assert.notEqual(start, -1, `${job} definition must exist`);
  const rest = releaseWorkflow.slice(start + 1);
  const nextJobOffset = rest.search(/\n  [a-z][a-z0-9_]*:\n/);
  return nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
}

assert.match(
  qualityGatesWorkflow,
  /^  h2_3_release_proof_contract:/m,
  "quality gates must contain the H2.3 proof contract",
);
assert.match(
  qualityGatesWorkflow,
  /npm run test:h2-3-release-proof/,
  "quality gates must execute the H2.3 proof contract",
);
assert.match(
  jobBlock("quality_gates"),
  /needs:[\s\S]*release_source_guard/,
  "quality_gates must be blocked by the release source guard",
);
assert.match(
  jobBlock("deploy_staging"),
  /needs:[\s\S]*quality_gates/,
  "deploy_staging must require the centralized quality gates",
);
assert.match(
  jobBlock("production_release_proof"),
  /needs:[\s\S]*production_smoke/,
  "production_release_proof must require production smoke",
);
assert.match(
  jobBlock("production_release_proof"),
  /needs:[\s\S]*h3_1_production_release_proof/,
  "production_release_proof must require H3.1 production proof",
);
// Release smoke/proof jobs must bind application provenance to the GitHub
// workflow commit SHA, rather than relying on CI-provider-specific variables.
for (const [job, expectedVar] of [
  ["staging_smoke", "STAGING_EXPECTED_RELEASE_SHA"],
  ["production_smoke", "PRODUCTION_EXPECTED_RELEASE_SHA"],
]) {
  const block = jobBlock(job);
  assert.match(
    block,
    new RegExp(
      expectedVar +
        ": \\$\\{\\{\\s*github\\.sha\\s*\\}\\}",
    ),
    `${job} must bind expected release SHA to github.sha`,
  );
}

const deployStagingBlock = jobBlock("deploy_staging");
const deployProductionBlock = jobBlock("deploy_production");
for (const block of [deployStagingBlock, deployProductionBlock]) {
  assert.match(
    block,
    /NEXTACTION_RELEASE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
    "deploy jobs must pass github.sha to the deployment script",
  );
}

// The final proof must be production-only and must run after the live smoke.
const proofBlock = jobBlock("production_release_proof");
assert.match(proofBlock, /needs:[\s\S]*production_smoke/);
assert.match(proofBlock, /needs:[\s\S]*h3_1_production_release_proof/);
assert.match(proofBlock, /production:release-proof/);


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
  assert.ok(settlementMigration.includes(requiredValue), 'settlement migration must encode ' + requiredValue);
}
assert.match(settlementMigration, /available_units = available_units - 1/);
assert.match(settlementMigration, /financial_entries_settlement_account_uq/);
assert.ok(finalRuntimeMigration.includes("settlements_qualified_click_id_key"));
assert.ok(finalRuntimeMigration.includes("UNIQUE (qualified_click_id)"));
assert.match(finalRuntimeMigration, /runtime_click_qualify_and_settle/);
assert.match(finalRuntimeMigration, /runtime_record_and_qualify_click/);
assert.match(finalRuntimeMigration, /runtime_settle_qualified_click/);

console.log("H2.3 release proof contract: OK");
