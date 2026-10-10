import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [releaseWorkflow, qualityGatesWorkflow, deploy, requireEnv, requireFile, stagingSmoke, stagingAcceptanceScript] =
  await Promise.all([
    readFile(".github/workflows/release.yml", "utf8"),
    readFile(".github/workflows/quality-gates.yml", "utf8"),
    readFile("scripts/deploy-cloudflare.mjs", "utf8"),
    readFile("scripts/require-env.sh", "utf8"),
    readFile("scripts/require-file.sh", "utf8"),
    readFile("scripts/staging-smoke.mjs", "utf8"),
    readFile("scripts/staging-authenticated-acceptance.mjs", "utf8"),
  ]);

assert.match(releaseWorkflow, /^on:\n  workflow_dispatch:/m);

assert.match(
  releaseWorkflow,
  /release_target:[\s\S]*?default:\s*staging[\s\S]*?options:[\s\S]*?- staging[\s\S]*?- production/,
  "manual Release Gate must default to staging-only validation",
);

for (const job of [
  "hold_production",
  "deploy_production",
  "cloudflare_production_audit",
  "production_smoke",
  "h3_1_production_release_proof",
  "production_release_proof",
]) {
  assert.match(
    jobBlock(releaseWorkflow, job),
    /if:\s*\$\{\{\s*inputs\.release_target\s*==\s*'production'\s*\}\}/,
    job + " must require an explicit production target",
  );
}
assert.match(
  releaseWorkflow,
  /release_source_guard:[\s\S]*?github\.ref_name[\s\S]*?master/,
);
assert.match(
  releaseWorkflow,
  /release_source_guard:[\s\S]*?Release gate may only run from master/,
);

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
  "analysis_provider_smoke",
  "deploy_staging",
  "staging_smoke",
  "h3_1_staging_release_proof",
  "h3_1_staging_runtime_smoke",
  "authenticated_staging_acceptance",
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

function jobBlock(workflow, job) {
  const start = workflow.indexOf("\n  " + job + ":");
  assert.notEqual(start, -1, `${job} definition must exist`);
  const rest = workflow.slice(start + 1);
  const nextJobOffset = rest.search(/\n  [a-z][a-z0-9_]*:\n/);
  return nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
}

const guard = jobBlock(releaseWorkflow, "release_source_guard");
assert.match(
  guard,
  /GITHUB_REF_NAME|NEXTACTION_RELEASE_BRANCH/,
  "release source guard must inspect the selected GitHub branch",
);
assert.match(
  guard,
  /Release gate may only run from master/,
  "release source guard must reject non-master releases",
);

assert.match(qualityGatesWorkflow, /^  h3_1_network_moment_contract:/m);
assert.match(qualityGatesWorkflow, /npm run test:h3-1-network-moment/);

const qualityGateBlock = jobBlock(releaseWorkflow, "quality_gates");
assert.match(
  qualityGateBlock,
  /needs:[\s\S]*release_source_guard/,
  "quality gates must be blocked by the release source guard",
);
assert.match(
  jobBlock(releaseWorkflow, "analysis_provider_smoke"),
  /needs:[\s\S]*quality_gates/,
  "analysis provider smoke must wait for centralized quality gates",
);
assert.match(
  jobBlock(releaseWorkflow, "deploy_staging"),
  /needs:[\s\S]*quality_gates/,
  "staging deployment must wait for centralized quality gates",
);

for (const job of [
  "quality",
  "release_boundary_contract",
  "product_scanner_security",
  "analysis_provider_contract",
  "analysis_output_contract",
  "analysis_provider_content_contract",
  "stage16_activation_contract",
  "runtime_hardening_contract",
  "h2_3_release_proof_contract",
  "h3_1_network_moment_contract",
  "cloudflare_compatibility",
  "cloudflare_build",
]) {
  assert.doesNotMatch(
    releaseJobs,
    new RegExp("^  " + job + ":", "m"),
    job + " must not be duplicated in release workflow",
  );
}

const deployStaging = jobBlock(releaseWorkflow, "deploy_staging");
const deployProduction = jobBlock(releaseWorkflow, "deploy_production");
assert.match(
  deployStaging,
  /NEXTACTION_RELEASE_BRANCH:\s*\$\{\{\s*github\.ref_name\s*\}\}/,
);
assert.match(
  deployStaging,
  /NEXTACTION_RELEASE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
);
assert.match(
  deployProduction,
  /NEXTACTION_RELEASE_BRANCH:\s*\$\{\{\s*github\.ref_name\s*\}\}/,
);
assert.match(
  deployProduction,
  /NEXTACTION_RELEASE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
);

const stagingAcceptance = jobBlock(releaseWorkflow, "authenticated_staging_acceptance");
assert.match(stagingAcceptance, /needs:[\s\S]*deploy_staging/);
assert.match(stagingAcceptance, /needs:[\s\S]*h3_1_staging_runtime_smoke/);
assert.match(stagingAcceptance, /STAGING_SUPABASE_SECRET_KEY/);
assert.match(stagingAcceptance, /playwright@1\.64\.0/);
assert.match(stagingAcceptance, /node scripts\/staging-authenticated-acceptance\.mjs/);
const cookieResultBlock = stagingAcceptanceScript.slice(
  stagingAcceptanceScript.indexOf("const result = {"),
  stagingAcceptanceScript.indexOf("return result;", stagingAcceptanceScript.indexOf("const result = {")),
);
assert.match(cookieResultBlock, /url:\\s*baseUrl/);
assert.doesNotMatch(
  cookieResultBlock,
  /path:/,
  "Playwright cookies scoped with url must not also set path",
);

assert.match(stagingAcceptanceScript, /auth\.admin\.createUser/);
assert.match(stagingAcceptanceScript, /auth\.admin\.deleteUser/);
assert.match(stagingAcceptanceScript, /\/v1\/connection\/verify/);
assert.match(stagingAcceptanceScript, /You are ready/);
assert.doesNotMatch(
  stagingAcceptanceScript,
  /console\.log\([^\n]*integrationToken/,
  "the staging acceptance runner must never log integration credentials",
);

const holdProduction = jobBlock(releaseWorkflow, "hold_production");
assert.match(holdProduction, /environment:\s*production/);
assert.match(holdProduction, /needs:[\s\S]*authenticated_staging_acceptance/);
assert.match(holdProduction, /needs:[\s\S]*staging_smoke/);
assert.match(holdProduction, /needs:[\s\S]*h3_1_staging_release_proof/);
assert.match(holdProduction, /needs:[\s\S]*h3_1_staging_runtime_smoke/);

const deployProductionNeeds = jobBlock(
  releaseWorkflow,
  "deploy_production",
);
assert.match(deployProductionNeeds, /needs:[\s\S]*hold_production/);

assert.match(
  stagingSmoke,
  /production_smoke_fixture_verify/,
  "staging smoke must wait for async Event -> Moment processing",
);
assert.match(
  stagingSmoke,
  /EVENT_PROCESSING_TIMEOUT_MS = 90_000/,
  "staging smoke must use a bounded Event processing wait",
);
assert.match(
  stagingSmoke,
  /waitForEventProcessing\(trackBodyJson\.event_id\)/,
  "staging smoke must wait before requesting an Offer",
);

assert.match(
  deploy,
  /target === "production"[\s\S]*?GITHUB_ACTIONS === "true"/,
);
assert.match(
  deploy,
  /process\.env\.GITHUB_SHA \|\| ""/,
);
assert.match(
  deploy,
  /process\.env\.NEXTACTION_RELEASE_SHA \|\| "unknown"/,
);
assert.match(
  deploy,
  /Production Cloudflare deployment is permitted from master only\./,
);

assert.doesNotMatch(
  releaseWorkflow,
  /test -n "\$\{[A-Z0-9_]+\}"/,
  "release workflow must not use silent test -n env checks",
);
assert.doesNotMatch(
  releaseWorkflow,
  /test -s \/tmp\/nextaction-release/,
  "release workflow must not use silent test -s file checks",
);

assert.match(requireEnv, /Missing required environment variables:/);
assert.match(requireFile, /Missing or empty required file\(s\):/);

for (const job of [
  "deploy_staging",
  "staging_smoke",
  "deploy_production",
  "cloudflare_production_audit",
  "production_smoke",
]) {
  assert.match(
    jobBlock(releaseWorkflow, job),
    /require-(env|file)\.sh/,
    `${job} must use loud validation`,
  );
}

console.log("release boundary contract: OK");
