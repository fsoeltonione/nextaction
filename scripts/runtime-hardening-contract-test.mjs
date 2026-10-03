import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [clickRoute, stage16, stage17, circleci, packageJson] = await Promise.all([
  readFile("src/app/v1/click/[delivery_token]/route.ts", "utf8"),
  readFile("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql", "utf8"),
  readFile("supabase/migrations/20261003000000_stage_17_remediation.sql", "utf8"),
  readFile(".circleci/config.yml", "utf8"),
  readFile("package.json", "utf8"),
]);

// H0: click safety and replay/expiry/no-capacity/error handling stay explicit.
assert.match(clickRoute, /runtime_click_qualify_and_settle/);
assert.match(clickRoute, /error\.code === "P0001"/);
assert.match(clickRoute, /row\.result_settlement_outcome === "no_capacity"/);
assert.match(clickRoute, /row\.result_settlement_outcome === "financial_unavailable"/);
assert.match(clickRoute, /row\.result_outcome === "expired"/);
assert.match(clickRoute, /row\.result_outcome !== "created"[\s\S]*row\.result_outcome !== "replayed"/);
assert.match(clickRoute, /Cache-Control/);

// H0: activation functions remain workspace-scoped and callable only through
// their intended authenticated boundary.
for (const fn of [
  "confirm_product_activation_v2",
  "set_workspace_capabilities_v2",
  "create_offer_activation_v2",
]) {
  assert.match(stage16, new RegExp(fn));
}
assert.match(stage16, /workspace not authorized/);
assert.match(stage16, /auth\.uid\(\)/);

// H0: atomic settlement keeps rollback semantics and canonical uniqueness.
assert.match(stage17, /runtime_click_qualify_and_settle/);
assert.match(stage17, /'financial_unavailable'/);
assert.match(stage17, /USING ERRCODE = 'P0001'/);
assert.match(stage17, /no_capacity is intentionally a committed, retryable business outcome/);
assert.match(stage17, /settlements_qualified_click_id_key/);
assert.match(stage17, /GRANT EXECUTE ON FUNCTION public\.runtime_click_qualify_and_settle\(TEXT\)[\s\S]*TO service_role/);

// H1: observability is additive, private, scheduled, and service-only.
const h1Path = "supabase/migrations/20261003230000_h0_h1_runtime_hardening.sql";
let h1;
try {
  h1 = await readFile(h1Path, "utf8");
} catch {
  throw new Error("H1 runtime hardening migration is missing.");
}
assert.match(h1, /CREATE TABLE IF NOT EXISTS private\.runtime_integrity_snapshots/);
assert.match(h1, /ALTER TABLE private\.runtime_integrity_snapshots ENABLE ROW LEVEL SECURITY/);
assert.match(h1, /REVOKE ALL ON TABLE private\.runtime_integrity_snapshots FROM PUBLIC, anon, authenticated/);
assert.match(h1, /CREATE OR REPLACE FUNCTION public\.runtime_integrity_audit\(\)/);
assert.match(h1, /SECURITY DEFINER/);
assert.match(h1, /SET search_path = ''/);
assert.match(h1, /queue_oldest_age_seconds/);
assert.match(h1, /financial_mismatch_count/);
assert.match(h1, /duplicate_consumption_count/);
assert.match(h1, /unsettled_qualified_click_count/);
assert.match(h1, /runtime-integrity-audit|nextaction-runtime-integrity-audit/);
assert.match(h1, /cron\.schedule/);
assert.match(h1, /SELECT public\.runtime_integrity_audit\(\)/);
assert.match(h1, /Scheduling an existing job name replaces that job definition/);

const pkg = JSON.parse(packageJson);
assert.equal(pkg.scripts["test:runtime-hardening"], "node scripts/runtime-hardening-contract-test.mjs");
assert.match(circleci, /runtime_hardening_contract:/);
assert.match(circleci, /npm run test:runtime-hardening/);

console.log("runtime hardening contract: OK");
