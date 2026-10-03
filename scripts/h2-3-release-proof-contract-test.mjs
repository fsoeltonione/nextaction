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
  packageJson,
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
  readFile("package.json", "utf8"),
]);

// H2.3 release provenance: the deployed runtime must expose the build SHA,
// and both staging and production release smoke must compare it with the CI
// source revision.
assert.match(healthRoute, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(healthRoute, /release_sha: releaseSha/);
assert.match(deploy, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(deploy, /CIRCLE_SHA1/);
assert.match(
  deploy,
  /process\.env\.CIRCLECI === "true"[\s\S]*process\.env\.CIRCLE_SHA1 \|\| ""/,
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
  "h2_3_release_proof_contract",
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
    new RegExp("^  " + job + ":",
    ),
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
  jobBlock("deploy_staging"),
  /needs:[\s\S]*h2_3_release_proof_contract/,
  "deploy_staging must require H2.3 proof contract",
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
// Release smoke/proof jobs must bind expected provenance to the pipeline revision.
// "environment:" lives in the top-level job definition; workflow entries only
// provide context/filters/requires.
const workflowDefinitionsEnd = circleci.indexOf("workflows:");
assert.notEqual(workflowDefinitionsEnd, -1, "CircleCI workflows section must exist");
const jobDefinitions = circleci.slice(0, workflowDefinitionsEnd);

for (const [job, expectedVar] of [
  ["staging_smoke", "STAGING_EXPECTED_RELEASE_SHA"],
  ["production_smoke", "PRODUCTION_EXPECTED_RELEASE_SHA"],
  ["production_release_proof", "PRODUCTION_EXPECTED_RELEASE_SHA"],
]) {
  const start = jobDefinitions.indexOf("\n  " + job + ":");
  assert.notEqual(start, -1, `${job} definition must exist`);
  const rest = jobDefinitions.slice(start + 1);
  const nextJobOffset = rest.search(/\n  [a-z][a-z0-9_]*:\n    docker:/);
  const block = nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
  assert.match(
    block,
    new RegExp(`environment:[\\s\\S]*${expectedVar}: << pipeline\\.git\\.revision >>`),
    `${job} must bind expected release SHA to pipeline revision`,
  );
}

// The final proof must be production-only and must run after the live smoke.
const proofStart = releaseWorkflow.indexOf("      - production_release_proof:");
const proofEnd = releaseWorkflow.indexOf("\n      - ", proofStart + 9);
const proofBlock = releaseWorkflow.slice(
  proofStart,
  proofEnd === -1 ? releaseWorkflow.length : proofEnd,
);
assert.match(proofBlock, /context:\n\s+- nextaction-production/);
assert.match(proofBlock, /filters:\n\s+branches:\n\s+only: master/);
assert.match(proofBlock, /requires:[\s\S]*production_smoke/);

console.log("H2.3 release proof contract: OK");
