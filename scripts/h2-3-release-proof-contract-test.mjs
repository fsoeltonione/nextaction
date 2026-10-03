import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  healthRoute,
  deploy,
  staging,
  production,
  releaseProof,
  migration,
  circleci,
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
  readFile(".circleci/config.yml", "utf8"),
  readFile("package.json", "utf8"),
]);

// H2.3 release provenance: the deployed runtime must expose the build SHA,
// and both staging and production release smoke must compare it with the CI
// source revision.
assert.match(healthRoute, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(healthRoute, /release_sha: releaseSha/);
assert.match(deploy, /NEXT_PUBLIC_RELEASE_SHA/);
assert.match(deploy, /CIRCLE_SHA1/);
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
assert.match(releaseProof, /Production release proof: PASS/);
assert.equal(
  JSON.parse(packageJson).scripts["production:release-proof"],
  "node scripts/production-release-proof.mjs",
);

// CircleCI must make the H2.3 contract a prerequisite for staging deployment
// and run final production proof only after production smoke.
const qualityStart = circleci.indexOf("  quality-gate:");
const releaseStart = circleci.indexOf("  release-gate:");
assert.notEqual(qualityStart, -1);
assert.notEqual(releaseStart, -1);
const qualityWorkflow = circleci.slice(qualityStart, releaseStart);
const releaseWorkflow = circleci.slice(releaseStart);

assert.match(qualityWorkflow, /h2_3_release_proof_contract:/);
assert.match(
  releaseWorkflow,
  /- h2_3_release_proof_contract/,
);
assert.match(
  releaseWorkflow,
  /production_release_proof:/,
);
assert.match(
  releaseWorkflow,
  /requires:[\s\S]*production_smoke[\s\S]*cloudflare_production_audit/,
);

console.log("H2.3 release proof contract: OK");
