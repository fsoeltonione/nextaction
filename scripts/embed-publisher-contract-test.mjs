import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("publisher embed contract is zero-SDK and explicit-moment based", async () => {
  const script = await read("public/nextaction.js");
  assert.match(script, /window\.show_ads\s*=/);
  assert.match(script, /\/v1\/public-offer/);
  assert.match(script, /publisher_key/);
  assert.match(script, /moment_key/);
  assert.match(script, /credentials:\s*["']omit["']/);
  assert.match(script, /catch\(function \(\) \{[\s\S]*?return null;/);
});

test("legacy AI analysis route is disabled", async () => {
  const route = await read("src/app/api/analyze/route.ts");
  assert.match(route, /product_analysis_removed/);
  assert.doesNotMatch(route, /scanProductUrl/);
  assert.doesNotMatch(route, /ANALYSIS_API_KEY/);
});

test("activation page avoids the legacy analysis endpoint and configures publisher only", async () => {
  const page = await read("src/app/activate/page.tsx");
  assert.doesNotMatch(page, /\/api\/analyze/);
  assert.match(page, /show_ads\("invoice_created"\)/);
  assert.doesNotMatch(page, /\/api\/offers\/create/);
  assert.doesNotMatch(page, /reach_customers/);
});

test("public offer endpoint records a server-side Moment event before decision", async () => {
  const route = await read("src/app/v1/public-offer/route.ts");
  assert.match(route, /publisher_key/);
  assert.match(route, /moment_key/);
  assert.doesNotMatch(route, /body\.url/);
  assert.doesNotMatch(route, /fetch\(.*body\.url/);
  assert.match(route, /runtime_accept_event/);
  assert.match(route, /runtime_process_event/);
  assert.match(route, /runtime_create_decision_delivery/);
  assert.match(route, /\/v1\/click\//);
});

test("package manifest preserves required release and TypeScript scripts", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts["production:release-proof"], "node scripts/production-release-proof.mjs");
  assert.equal(packageJson.devDependencies.typescript, "^5");
  assert.equal(packageJson.scripts["test:embed-publisher"], "node scripts/embed-publisher-contract-test.mjs");
});
