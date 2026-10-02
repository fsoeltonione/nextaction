import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [circleci, deploy, requireEnv, requireFile] = await Promise.all([
  readFile(".circleci/config.yml", "utf8"),
  readFile("scripts/deploy-cloudflare.mjs", "utf8"),
  readFile("scripts/require-env.sh", "utf8"),
  readFile("scripts/require-file.sh", "utf8"),
]);

assert.match(circleci, /release_source_guard:/);
assert.match(circleci, /NEXTACTION_RELEASE_BRANCH: << pipeline\.git\.branch >>/);
assert.match(circleci, /require-env\.sh NEXTACTION_RELEASE_BRANCH/);
assert.match(circleci, /Release gate may only run from master/);

const releaseWorkflowStart = circleci.indexOf("  release-gate:");
assert.notEqual(releaseWorkflowStart, -1, "release-gate workflow must exist");
const releaseWorkflow = circleci.slice(releaseWorkflowStart);

// release_source_guard must be present as an actual job in the release-gate
// workflow's jobs list, not just referenced from other jobs' requires: lists.
// A requires: entry in CircleCI must name a job that exists in the same
// workflow's jobs: block, otherwise the pipeline fails config validation
// with "requires 'X', which is the name of 0 other jobs in workflow ...".
const guardJobStart = releaseWorkflow.indexOf("      - release_source_guard:");
assert.notEqual(
  guardJobStart,
  -1,
  "release_source_guard must be listed as a job in the release-gate workflow",
);
const guardJobEnd = releaseWorkflow.indexOf("\n      - ", guardJobStart + 9);
const guardJobBlock = releaseWorkflow.slice(
  guardJobStart,
  guardJobEnd === -1 ? releaseWorkflow.length : guardJobEnd,
);
assert.match(guardJobBlock, /filters:\n\s+branches:\n\s+only: master/);

for (const job of [
  "analysis_provider_smoke",
  "deploy_staging",
  "staging_smoke",
  "hold_production",
  "deploy_production",
  "cloudflare_production_audit",
  "production_smoke",
]) {
  const start = releaseWorkflow.indexOf("      - " + job + ":");
  assert.notEqual(start, -1, `${job} must exist in release-gate`);
  const end = releaseWorkflow.indexOf("\n      - ", start + 9);
  const block = releaseWorkflow.slice(start, end === -1 ? releaseWorkflow.length : end);
  assert.match(block, /filters:\n\s+branches:\n\s+only: master/);
  assert.match(block, /requires:[\s\S]*release_source_guard/);
}

assert.match(
  deploy,
  /target === "production"[\s\S]*?process\.env\.CIRCLECI === "true"[\s\S]*?releaseBranch !== "master"/,
);
assert.match(deploy, /Production Cloudflare deployment is permitted from master only\./);
// The guard must not depend solely on NEXTACTION_RELEASE_BRANCH: a deploy job
// that forgot to set it read `undefined` and refused a master deploy. The
// built-in CIRCLE_BRANCH is the fallback so a missing explicit variable cannot
// be mistaken for a non-master release.
assert.match(deploy, /process\.env\.NEXTACTION_RELEASE_BRANCH \|\| process\.env\.CIRCLE_BRANCH/);

// Every job that runs the deploy script must also receive the release branch,
// either as an explicit environment entry or (for staging) not at all is not
// acceptable for production.
for (const job of ["deploy_staging", "deploy_production"]) {
  const start = circleci.search(new RegExp("\\n  " + job + ":\\n"));
  assert.notEqual(start, -1, `${job} must exist`);
  const rest = circleci.slice(start + 1);
  const nextJobOffset = rest.search(/\n  [a-z][a-z0-9_]*:\n    docker:/);
  const block = nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
  assert.match(
    block,
    /NEXTACTION_RELEASE_BRANCH: << pipeline\.git\.branch >>/,
    `${job} must receive NEXTACTION_RELEASE_BRANCH`,
  );
}

// Env/file presence checks in the release path must be loud: a bare
// `test -n "${VAR}"` exits 1 with no output ("Exited with code exit status 1")
// and hides which context variable was missing. Every release job that
// validates context inputs must use the reporting helpers instead.
assert.doesNotMatch(
  circleci,
  /test -n "\$\{[A-Z0-9_]+\}"/,
  "release config must not use silent `test -n` env checks",
);
assert.doesNotMatch(
  circleci,
  /test -s \/tmp\/nextaction-release/,
  "release config must not use silent `test -s` file checks",
);
for (const job of [
  "deploy_staging",
  "staging_smoke",
  "deploy_production",
  "cloudflare_production_audit",
  "production_smoke",
]) {
  const startMatch = new RegExp("\\n  " + job + ":\\n");
  const start = circleci.search(startMatch);
  assert.notEqual(start, -1, `${job} must exist`);
  // A job definition starts at 2-space indentation with `name:` then `docker:`.
  const rest = circleci.slice(start + 1);
  const nextJobOffset = rest.search(/\n  [a-z][a-z0-9_]*:\n    docker:/);
  const block =
    nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
  assert.match(block, /require-(env|file)\.sh/, `${job} must use loud validation`);
}
assert.match(requireEnv, /Missing required environment variables:/);
assert.match(requireFile, /Missing or empty required file\(s\):/);

console.log("release boundary contract: OK");
