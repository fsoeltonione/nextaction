import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [http, requestBody, analysis, providerSmoke, click, packageJson, workflow] = await Promise.all([
  readFile("src/lib/http.ts", "utf8"),
  readFile("src/lib/request-body.ts", "utf8"),
  readFile("src/app/api/analyze/route.ts", "utf8"),
  readFile("scripts/analysis-provider-smoke.mjs", "utf8"),
  readFile("src/app/v1/click/[delivery_token]/route.ts", "utf8"),
  readFile("package.json", "utf8"),
  readFile(".github/workflows/quality-gates.yml", "utf8"),
]);

assert.match(http, /request\.body\.getReader\(\)/);
assert.match(http, /totalBytes\s*\+\s*value\.byteLength\s*>\s*maxBytes/);
assert.match(http, /await reader\.cancel\(\)/);
assert.doesNotMatch(http, /const body = await request\.text\(\)/);

const responseRead = analysis.indexOf("responseText = await readLimitedText(response, MAX_PROVIDER_RESPONSE_BYTES)");
const clearTimeout = analysis.indexOf("clearTimeout(timeout)", responseRead);
assert.ok(responseRead > -1, "analysis route must explicitly read the provider response body");
assert.ok(clearTimeout > responseRead, "provider timeout must cover response body consumption");
assert.match(analysis, /providerBase\.protocol !== "https:"/);
assert.match(providerSmoke, /base\.protocol !== "https:"/);

const redirectStart = click.indexOf("function redirectToDestination");
const redirectEnd = click.indexOf("\n}\n", redirectStart);
const redirectBlock = click.slice(redirectStart, redirectEnd);
assert.match(redirectBlock, /Referrer-Policy/);
assert.match(redirectBlock, /no-referrer/);

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
]) {
  assert.ok(qualityBlock.includes(requiredCommand), `required Quality job is missing: ${requiredCommand}`);
}
assert.match(packageJson, /"test:http-body":\s*"node --experimental-strip-types --test scripts\/http-body-test\.ts"/);
assert.match(packageJson, /"test:runtime-resource-contract":\s*"node scripts\/runtime-resource-contract-test\.mjs"/);
assert.match(packageJson, /"test:migration-filenames":\s*"node scripts\/migration-filenames-test\.mjs"/);

console.log("Runtime resource and required-gate contract: OK");
