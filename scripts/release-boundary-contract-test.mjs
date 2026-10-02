import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [circleci, deploy] = await Promise.all([
  readFile(".circleci/config.yml", "utf8"),
  readFile("scripts/deploy-cloudflare.mjs", "utf8"),
]);

assert.match(circleci, /release_source_guard:/);
assert.match(circleci, /NEXTACTION_RELEASE_BRANCH: << pipeline\.git\.branch >>/);
assert.match(circleci, /test "\$\{NEXTACTION_RELEASE_BRANCH\}" = "master"/);

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
  /target === "production"[\s\S]*?process\.env\.CIRCLECI === "true"[\s\S]*?process\.env\.NEXTACTION_RELEASE_BRANCH !== "master"/,
);
assert.match(deploy, /Production Cloudflare deployment is permitted from master only\./);

console.log("release boundary contract: OK");
