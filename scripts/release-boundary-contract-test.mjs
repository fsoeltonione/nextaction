import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [releaseWorkflow, qualityGatesWorkflow, deploy, requireEnv, requireFile, stagingSmoke, stagingAcceptanceScript, anonymousAcceptanceScript, effectiveConfigGate] =
  await Promise.all([
    readFile(".github/workflows/release.yml", "utf8"),
    readFile(".github/workflows/quality-gates.yml", "utf8"),
    readFile("scripts/deploy-cloudflare.mjs", "utf8"),
    readFile("scripts/require-env.sh", "utf8"),
    readFile("scripts/require-file.sh", "utf8"),
    readFile("scripts/staging-smoke.mjs", "utf8"),
    readFile("scripts/staging-authenticated-acceptance.mjs", "utf8"),
    readFile("scripts/staging-anonymous-proposal-acceptance.mjs", "utf8"),
    readFile("scripts/verify-effective-cloudflare-config.mjs", "utf8"),
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
  "deploy_staging",
  "staging_smoke",
  "h3_1_staging_release_proof",
  "h3_1_staging_runtime_smoke",
  "anonymous_staging_proposal_acceptance",
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
assert.doesNotMatch(
  qualityGatesWorkflow,
  /^  dependency_security_audit:/m,
  "dependency auditing must not depend on an optional status check",
);
const requiredQualityJob = jobBlock(qualityGatesWorkflow, "quality");
for (const requiredCommand of [
  "npm run test:braces-security-backport",
  "npm run test:http-body",
  "npm run test:runtime-resource-contract",
  "npm run test:embed-publisher",
  "npm run test:migration-filenames",
  "npm run test:cloudflare-production-audit-contract",
  "npm run test:effective-cloudflare-config",
  "npm audit --audit-level=low",
  "npm audit --omit=dev --audit-level=low",
]) {
  assert.ok(
    requiredQualityJob.includes(requiredCommand),
    "required Quality status check must execute " + requiredCommand,
  );
}
assert.match(qualityGatesWorkflow, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
assert.match(qualityGatesWorkflow, /uses: actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\.1\.0/);
assert.match(qualityGatesWorkflow, /runs-on: ubuntu-24\.04/);


const cloudflareBuildJob = jobBlock(qualityGatesWorkflow, "cloudflare_build");
const cloudflareArtifactBuild = cloudflareBuildJob.indexOf("npm run cloudflare:build");
const effectiveConfigAudit = cloudflareBuildJob.indexOf(
  "node scripts/verify-effective-cloudflare-config.mjs staging",
);
const cloudflareDryRun = cloudflareBuildJob.indexOf(
  "wrangler@4.139.0 deploy --dry-run --env staging",
);
assert.ok(
  cloudflareArtifactBuild !== -1 &&
    effectiveConfigAudit > cloudflareArtifactBuild &&
    cloudflareDryRun > effectiveConfigAudit,
  "CI must validate the generated staging Wrangler config after build and before Wrangler dry-run",
);

assert.doesNotMatch(
  releaseWorkflow,
  /analysis_provider_smoke|analysis:provider-smoke|staging:scanner-security-smoke|ANALYSIS_(API_KEY|BASE_URL|MODEL)/,
  "embed-only Release Gate must not depend on retired AI analysis or scanner smoke paths",
);

const qualityGateBlock = jobBlock(releaseWorkflow, "quality_gates");
assert.match(
  qualityGateBlock,
  /needs:[\s\S]*release_source_guard/,
  "quality gates must be blocked by the release source guard",
);
assert.match(
  jobBlock(releaseWorkflow, "deploy_staging"),
  /needs:[\s\S]*quality_gates/,
  "staging deployment must wait for centralized quality gates",
);

for (const job of [
  "quality",
  "release_boundary_contract",
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

const anonymousStagingAcceptance = jobBlock(releaseWorkflow, "anonymous_staging_proposal_acceptance");
assert.match(anonymousStagingAcceptance, /needs:[\s\S]*deploy_staging/);
assert.match(anonymousStagingAcceptance, /needs:[\s\S]*staging_smoke/);
assert.match(anonymousStagingAcceptance, /STAGING_BASE_URL:/);
assert.doesNotMatch(anonymousStagingAcceptance, /STAGING_SUPABASE_SECRET_KEY|STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
assert.match(anonymousStagingAcceptance, /node scripts\/staging-anonymous-proposal-acceptance\.mjs/);

const stagingAcceptance = jobBlock(releaseWorkflow, "authenticated_staging_acceptance");
assert.match(stagingAcceptance, /needs:[\s\S]*anonymous_staging_proposal_acceptance/);
assert.match(stagingAcceptance, /needs:[\s\S]*deploy_staging/);
assert.match(stagingAcceptance, /needs:[\s\S]*h3_1_staging_runtime_smoke/);
assert.match(stagingAcceptance, /STAGING_SUPABASE_SECRET_KEY/);
assert.match(stagingAcceptance, /playwright@1\.64\.0/);
assert.match(stagingAcceptance, /node scripts\/staging-authenticated-acceptance\.mjs/);
assert.match(anonymousAcceptanceScript, /api\/onboarding\/state/);
assert.match(anonymousAcceptanceScript, /Confirm product understanding/);
assert.match(anonymousAcceptanceScript, /confirmResponse\.status\(\)/);
assert.match(anonymousAcceptanceScript, /loginUrl\.searchParams\.get\("url"\)/);
assert.match(anonymousAcceptanceScript, /Staging anonymous URL-first proposal acceptance: PASS/);
const cookieResultBlock = stagingAcceptanceScript.slice(
  stagingAcceptanceScript.indexOf("const result = {"),
  stagingAcceptanceScript.indexOf("return result;", stagingAcceptanceScript.indexOf("const result = {")),
);
assert.match(cookieResultBlock, /url:\s*baseUrl/);
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
  /"--var",\s*"NEXT_PUBLIC_RELEASE_SHA:"\s*\+\s*releaseSha/,
  "Cloudflare deployment must bind the current release SHA into the Worker runtime",
);
assert.match(
  effectiveConfigGate,
  /global_fetch_strictly_public/,
  "effective runtime config gate must require the public-fetch security flag",
);
assert.match(
  effectiveConfigGate,
  /network_override_keys_found/,
  "effective runtime config gate must report unreviewed network override keys",
);
const cloudflareBuildInvocation = deploy.indexOf('run(process.execPath, ["scripts/cloudflare-vinext-build.mjs"]);');
const effectiveConfigGateInvocation = deploy.indexOf('"scripts/verify-effective-cloudflare-config.mjs"');
const wranglerDeployInvocation = deploy.indexOf('run(npx, [');
assert.ok(
  cloudflareBuildInvocation !== -1 &&
    effectiveConfigGateInvocation > cloudflareBuildInvocation &&
    wranglerDeployInvocation > effectiveConfigGateInvocation,
  "effective Cloudflare config validation must run after build and before any Wrangler deployment",
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
