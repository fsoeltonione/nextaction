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
