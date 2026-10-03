import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [clickRoute, stage16, stage17, runtimeHttp, readyRoute, circleci, packageJson] = await Promise.all([
  readFile("src/app/v1/click/[delivery_token]/route.ts", "utf8"),
  readFile("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql", "utf8"),
  readFile("supabase/migrations/20261003000000_stage_17_remediation.sql", "utf8"),
  readFile("src/lib/runtime/http.ts", "utf8"),
  readFile("src/app/api/health/ready/route.ts", "utf8"),
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
assert.match(h1, /GRANT EXECUTE ON FUNCTION public\.runtime_integrity_audit\(\)[\s\S]*TO service_role/);
assert.match(h1, /GRANT EXECUTE ON FUNCTION public\.runtime_integrity_latest\(\)[\s\S]*TO service_role/);
assert.match(h1, /Scheduling an existing job name replaces that job definition/);


const h1CanaryPath = "supabase/migrations/20261004001500_h1_canary_exclusion.sql";
let h1Canary;
try {
  h1Canary = await readFile(h1CanaryPath, "utf8");
} catch {
  throw new Error("H1 canary exclusion migration is missing.");
}
assert.match(h1Canary, /CREATE TABLE IF NOT EXISTS private\.runtime_excluded_workspaces/);
assert.match(h1Canary, /production\/staging smoke canary/);
assert.match(h1Canary, /runtime_excluded_workspaces_no_access/);
assert.match(h1Canary, /ON private\.runtime_excluded_workspaces/);
assert.match(h1Canary, /runtime_integrity_audit\(\)/);
assert.match(h1Canary, /NOT EXISTS \(\s*SELECT 1[\s\S]*runtime_excluded_workspaces/);
assert.match(h1Canary, /excluded_workspace_count/);


// H2.1: runtime failure containment is bounded, durable, and terminal.
// The contract deliberately checks both sides of the invariant:
// retryable failures may retry only within a finite budget, while malformed
// and permanent failures are durably quarantined instead of looping forever.
const h2Path = "supabase/migrations/20261004010000_h2_1_runtime_failure_containment.sql";
let h2;
try {
  h2 = await readFile(h2Path, "utf8");
} catch {
  throw new Error("H2.1 runtime failure containment migration is missing.");
}

assert.match(h2, /ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0/);
assert.match(h2, /ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ/);
assert.match(h2, /ADD COLUMN IF NOT EXISTS last_failure_class TEXT/);
assert.match(h2, /ADD COLUMN IF NOT EXISTS last_failure_code TEXT/);
assert.match(h2, /ADD COLUMN IF NOT EXISTS last_failure_reason TEXT/);
assert.match(h2, /ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ/);

assert.match(h2, /CREATE TABLE IF NOT EXISTS private\.runtime_dead_letters/);
assert.match(h2, /runtime_dead_letters_queue_message_uq/);
assert.match(h2, /ALTER TABLE private\.runtime_dead_letters ENABLE ROW LEVEL SECURITY/);
assert.match(h2, /REVOKE ALL ON TABLE private\.runtime_dead_letters FROM PUBLIC, anon, authenticated/);
assert.match(h2, /CREATE POLICY runtime_dead_letters_no_access/);
assert.match(h2, /GRANT ALL PRIVILEGES ON TABLE private\.runtime_dead_letters TO service_role/);

assert.match(h2, /CREATE OR REPLACE FUNCTION private\.runtime_quarantine_message/);
assert.match(h2, /pgmq\.archive\(/);
assert.match(h2, /RETURN NOT EXISTS \(\s*SELECT 1[\s\S]*q_runtime-events/);

assert.match(h2, /CREATE OR REPLACE FUNCTION public\.runtime_worker_tick\(\s*p_quantity INTEGER DEFAULT 20,\s*p_visibility_seconds INTEGER DEFAULT 60\s*\)/);
assert.match(h2, /v_max_attempts CONSTANT INTEGER := 5/);
assert.match(h2, /SELECT msg_id, read_ct, enqueued_at, message/);
assert.match(h2, /GET STACKED DIAGNOSTICS/);
assert.match(h2, /RETURNED_SQLSTATE/);
assert.match(h2, /v_failure_class := 'permanent'/);
assert.match(h2, /v_failure_class := 'retry_exhausted'/);
assert.match(h2, /v_failure_class := 'retryable'/);
assert.match(h2, /processing_status = CASE[\s\S]*'failed'[\s\S]*'accepted'/);
assert.match(h2, /private\.runtime_quarantine_message\(/);

assert.match(h2, /IF NOT v_process_returned[\s\S]*result_processed/);
assert.match(h2, /result_reason_code/);
assert.match(h2, /Referenced event does not exist\./);

// H2.1 must keep the worker callable only from the service boundary.
assert.match(h2, /REVOKE ALL ON FUNCTION public\.runtime_worker_tick\(INTEGER, INTEGER\)[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(h2, /GRANT EXECUTE ON FUNCTION public\.runtime_worker_tick\(INTEGER, INTEGER\)[\s\S]*TO service_role/);


// H2.2: recovery and runtime operations stay bounded and operationally visible.
const h22Path = "supabase/migrations/20261004020000_h2_2_recovery_operations.sql";
let h22;
try {
  h22 = await readFile(h22Path, "utf8");
} catch {
  throw new Error("H2.2 recovery operations migration is missing.");
}

assert.match(h22, /CREATE OR REPLACE FUNCTION public\.runtime_operations_tick/);
assert.match(h22, /FOR UPDATE SKIP LOCKED/);
assert.match(h22, /stale_events_marked_processed/);
assert.match(h22, /stale_events_requeued/);
assert.match(h22, /pgmq\.send\(/);
assert.match(h22, /DELETE FROM private\.rate_limit_buckets/);
assert.match(h22, /p_rate_limit_retention_seconds INTEGER DEFAULT 7200/);
assert.match(h22, /nextaction-runtime-operations/);
assert.match(h22, /'\*\/5 \* \* \* \*'/);

assert.match(h22, /CREATE OR REPLACE FUNCTION public\.runtime_readiness\(\)/);
assert.match(h22, /runtime-events/);
assert.match(h22, /nextaction-runtime-worker/);
assert.match(h22, /job_run_details/);
assert.match(h22, /status = 'succeeded'/);
assert.match(h22, /INTERVAL '3 minutes'/);
assert.match(h22, /nextaction-runtime-operations/);
assert.match(h22, /GRANT EXECUTE ON FUNCTION public\.runtime_readiness\(\)[\s\S]*TO service_role/);

// H2.2: readiness is a service-side dependency check and never exposes
// database error details to the caller.
assert.match(readyRoute, /runtime_readiness/);
assert.match(readyRoute, /status: "not_ready"/);
assert.match(readyRoute, /status === "ready" \? 200 : 503/);
assert.match(readyRoute, /X-Request-Id/);
assert.match(readyRoute, /Cache-Control/);

// H2.2: Cloudflare is the explicit IP trust boundary; forwarded chains are ignored.
assert.match(runtimeHttp, /CF-Connecting-IP is the[\s\S]*Cloudflare-provided client IP header/);
assert.match(runtimeHttp, /return cloudflareIp \|\| "unknown"/);
assert.doesNotMatch(runtimeHttp, /x-forwarded-for/);


// H2.2 follow-up: latest scheduler run must drive readiness, not any older success.
const h22FollowupPath = "supabase/migrations/20261004021000_h2_2_runtime_ops_hardening.sql";
let h22Followup;
try {
  h22Followup = await readFile(h22FollowupPath, "utf8");
} catch {
  throw new Error("H2.2 runtime operations hardening migration is missing.");
}
assert.match(h22Followup, /DELETE FROM private\.runtime_dead_letters/);
assert.match(h22Followup, /INTERVAL '30 days'/);
assert.match(h22Followup, /SELECT d\.status, d\.start_time/);
assert.match(h22Followup, /ORDER BY d\.start_time DESC/);
assert.match(h22Followup, /v_worker_recent_success :=/);
assert.match(h22Followup, /v_operations_recent_success :=/);
assert.match(h22Followup, /last_run_status/);
assert.match(h22Followup, /last_run_started_at/);

// Release smoke must verify the runtime readiness endpoint in both environments.
assert.match(staging, /\/api\/health\/ready/);
assert.match(staging, /operations\?\.schedule_active/);
assert.match(production, /\/api\/health\/ready/);
assert.match(production, /operations\?\.schedule_active/);

const pkg = JSON.parse(packageJson);
assert.equal(pkg.scripts["test:runtime-hardening"], "node scripts/runtime-hardening-contract-test.mjs");
assert.match(circleci, /runtime_hardening_contract:/);
assert.match(circleci, /npm run test:runtime-hardening/);

console.log("runtime hardening contract: OK");
