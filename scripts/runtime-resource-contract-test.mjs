import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [http, requestBody, analysis, click, packageJson, workflow, embedRoute, embedScript] = await Promise.all([
  readFile("src/lib/http.ts", "utf8"),
  readFile("src/lib/request-body.ts", "utf8"),
  readFile("src/app/api/analyze/route.ts", "utf8"),
  readFile("src/app/v1/click/[delivery_token]/route.ts", "utf8"),
  readFile("package.json", "utf8"),
  readFile(".github/workflows/quality-gates.yml", "utf8"),
  readFile("src/app/v1/public-offer/route.ts", "utf8"),
  readFile("public/nextaction.js", "utf8"),
]);

assert.ok(requestBody.includes("stream.getReader()"));
assert.ok(requestBody.includes("totalBytes + value.byteLength > maxBytes"));
assert.ok(requestBody.includes("await reader.cancel()"));
assert.equal(requestBody.includes("const body = await request.text()"), false);
assert.ok(http.includes('export { HttpError, MAX_JSON_BODY_BYTES, readJsonBody } from "./request-body.ts";'));

assert.match(analysis, /product_analysis_removed/);
assert.match(analysis, /410/);
assert.doesNotMatch(analysis, /scanProductUrl|ANALYSIS_API_KEY|readLimitedText|fetch\(/);

const redirectStart = click.indexOf("function redirectToDestination");
const redirectEnd = click.indexOf("\n}\n", redirectStart);
const redirectBlock = click.slice(redirectStart, redirectEnd);
assert.match(redirectBlock, /Referrer-Policy/);
assert.match(redirectBlock, /no-referrer/);

assert.match(embedRoute, /runtime_accept_event/);
assert.match(embedRoute, /runtime_process_event/);
assert.match(embedRoute, /runtime_create_decision_delivery/);
assert.match(embedRoute, /publisher_key/);
assert.match(embedRoute, /moment_key/);
assert.match(embedScript, /window\.show_ads\s*=/);
assert.match(embedScript, /credentials:\s*["']omit["']/);
assert.match(embedScript, /catch\(function \(\) \{[\s\S]*?return null;/);

const qualityStart = workflow.indexOf("  quality:\n");
const nextJob = workflow.indexOf("\n  release_boundary_contract:", qualityStart);
assert.ok(qualityStart > -1 && nextJob > qualityStart, "merge-required Quality job must exist");
const qualityBlock = workflow.slice(qualityStart, nextJob);
for (const requiredCommand of [
  "npm run test:braces-security-backport",
  "npm audit --audit-level=low",
  "npm audit --omit=dev --audit-level=low",
  "npm run test:cloudflare-production-audit-contract",
  "npm run test:http-body",
  "npm run test:runtime-resource-contract",
  "npm run test:migration-filenames",
  "npm run test:embed-publisher",
]) {
  assert.ok(qualityBlock.includes(requiredCommand), `required Quality job is missing: ${requiredCommand}`);
}
assert.match(packageJson, /"test:http-body":\s*"node --experimental-strip-types --test scripts\/http-body-test\.ts"/);
assert.match(packageJson, /"test:runtime-resource-contract":\s*"node scripts\/runtime-resource-contract-test\.mjs"/);
assert.match(packageJson, /"test:migration-filenames":\s*"node scripts\/migration-filenames-test\.mjs"/);
assert.match(packageJson, /"test:embed-publisher":\s*"node scripts\/embed-publisher-contract-test\.mjs"/);

console.log("Runtime resource and required-gate contract: OK");
