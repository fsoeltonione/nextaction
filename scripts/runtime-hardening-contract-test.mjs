import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [clickRoute, stage16, stage17, runtimeHttp, readyRoute, staging, production, qualityWorkflow, qualityGatesWorkflow, releaseWorkflow, packageJson] = await Promise.all([
  readFile("src/app/v1/click/[delivery_token]/route.ts", "utf8"),
  readFile("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql", "utf8"),
  readFile("supabase/migrations/20261003000000_stage_17_remediation.sql", "utf8"),
  readFile("src/lib/runtime/http.ts", "utf8"),
  readFile("src/app/api/health/ready/route.ts", "utf8"),
  readFile("scripts/staging-smoke.mjs", "utf8"),
  readFile("scripts/production-smoke.mjs", "utf8"),
  readFile(".github/workflows/quality.yml", "utf8"),
  readFile(".github/workflows/quality-gates.yml", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
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

assert.match(h22, /runtime_operations_tick/);
assert.match(h22, /FOR UPDATE SKIP LOCKED/);
assert.match(h22, /stale_events_marked_processed/);
assert.match(h22, /stale_events_requeued/);
assert.match(h22, /pgmq\.send/);
assert.match(h22, /rate_limit_buckets/);
assert.match(h22, /nextaction-runtime-operations/);
assert.match(h22, /runtime_readiness/);
assert.match(h22, /job_run_details/);
assert.match(h22, /status = 'succeeded'/);
assert.match(h22, /GRANT EXECUTE ON FUNCTION public\.runtime_readiness\(\)[\s\S]*TO service_role/);

// H2.2 follow-up: lifecycle retention and latest-run readiness semantics.
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
assert.match(h22Followup, /v_worker_recent_success/);
assert.match(h22Followup, /v_operations_recent_success/);
assert.match(h22Followup, /last_run_status/);
assert.match(h22Followup, /last_run_started_at/);

// Release smoke must verify the runtime readiness endpoint in both environments.
assert.match(staging, /\/api\/health\/ready/);
assert.match(staging, /operations\?\.schedule_active/);
assert.match(production, /\/api\/health\/ready/);
assert.match(production, /operations\?\.schedule_active/);
assert.match(readyRoute, /runtime_readiness/);
assert.match(readyRoute, /row\?\.status === "ready"/);
assert.match(readyRoute, /Cache-Control/);
assert.match(readyRoute, /X-Request-Id/);

assert.match(production, /EVENT_PROCESSING_TIMEOUT_MS = 90_000/);
assert.match(production, /timeoutMs = EVENT_PROCESSING_TIMEOUT_MS/);

// H2.2: Cloudflare is the explicit IP trust boundary.
assert.match(runtimeHttp, /cf-connecting-ip/);
assert.match(runtimeHttp, /return cloudflareIp \|\| "unknown"/);
assert.doesNotMatch(runtimeHttp, /\.get\(["']x-forwarded-for["']\)/);

const pkg = JSON.parse(packageJson);
assert.equal(pkg.scripts["test:runtime-hardening"], "node scripts/runtime-hardening-contract-test.mjs");
for (const approvedInstallScript of [
  "unrs-resolver@1.12.2",
  "esbuild@0.28.1",
  "workerd@1.20260916.1",
  "workerd@1.20260923.1",
]) {
  assert.equal(
    pkg.allowScripts?.[approvedInstallScript],
    true,
    `The reviewed native tooling install script ${approvedInstallScript} must be pinned in allowScripts.`,
  );
}
assert.match(qualityWorkflow, /^  quality_gates:/m);
assert.match(qualityWorkflow, /uses: \.\/\.github\/workflows\/quality-gates\.yml/);
assert.match(qualityGatesWorkflow, /^  runtime_hardening_contract:/m);
assert.match(qualityGatesWorkflow, /npm run test:runtime-hardening/);
assert.match(releaseWorkflow, /^  release_source_guard:/m);
assert.match(releaseWorkflow, /quality_gates:[\s\S]*?needs:\n      - release_source_guard/);
assert.match(releaseWorkflow, /quality_gates:[\s\S]*?uses: \.\/\.github\/workflows\/quality-gates\.yml/);


 // H4.1: safely reconcile old Qualified Clicks that were retained when
// settlement returned no_capacity. The operation must not depend on a live
// Delivery token, must be bounded, and must stay behind service_role.
const h41Path = "supabase/migrations/20261011020000_h4_1_unsettled_settlement_recovery.sql";
const h41 = await readFile(h41Path, "utf8");
assert.match(h41, /CREATE OR REPLACE FUNCTION private\.reconcile_unsettled_qualified_clicks/);
assert.match(h41, /qc\.qualified_at < v_checked_at - INTERVAL '5 minutes'/);
assert.match(h41, /NOT EXISTS \([\s\S]*?private\.settlements[\s\S]*?s\.qualified_click_id = qc\.id/);
assert.match(h41, /private\.runtime_excluded_workspaces/);
assert.match(h41, /FOR UPDATE OF qc SKIP LOCKED/);
assert.match(h41, /public\.runtime_settle_qualified_click\(v_candidate\.id\)/);
assert.match(h41, /WHEN 'no_capacity'[\s\S]*v_no_capacity/);
assert.match(h41, /WHEN 'financial_unavailable'[\s\S]*v_financial_unavailable/);
assert.match(h41, /REVOKE ALL ON FUNCTION private\.reconcile_unsettled_qualified_clicks\(INTEGER\)[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(h41, /GRANT EXECUTE ON FUNCTION private\.reconcile_unsettled_qualified_clicks\(INTEGER\)[\s\S]*TO service_role/);
assert.match(h41, /private\.reconcile_unsettled_qualified_clicks\(p_recovery_limit\)/);
assert.match(h41, /qualified_click_settlement_recovery/);
assert.match(h41, /REVOKE ALL ON FUNCTION public\.runtime_operations_tick\(INTEGER, INTEGER, INTEGER\)[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(h41, /GRANT EXECUTE ON FUNCTION public\.runtime_operations_tick\(INTEGER, INTEGER, INTEGER\)[\s\S]*TO service_role/);

// Historical source migrations for the five activation RPCs must retain their
// authentication and workspace-membership guards. H4.2 moves these guarded
// implementations into private and exposes SECURITY INVOKER adapters only.
const [activationSecurity, networkMomentSecurity, networkOfferSecurity, controlPlanePrivilegeMigration] = await Promise.all([
  readFile("supabase/migrations/20260928183000_stage_16_v2_workspace_scope_qualification.sql", "utf8"),
  readFile("supabase/migrations/20261004034037_h3_1_network_moment_model.sql", "utf8"),
  readFile("supabase/migrations/20261004040300_h3_1_network_offer_validation.sql", "utf8"),
  readFile("supabase/migrations/20260929010000_stage_16_read_only_control_plane.sql", "utf8"),
]);
function securityDefinerFunction(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `missing source definition for ${name}`);
  const next = sql.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}
const scopedRpcMigrations = [
  [activationSecurity, "confirm_product_activation_v2"],
  [activationSecurity, "create_offer_activation_v2"],
  [activationSecurity, "set_workspace_capabilities_v2"],
  [networkMomentSecurity, "set_moment_network_mapping_v1"],
  [networkOfferSecurity, "create_network_offer_activation_v1"],
];
for (const [sql, name] of scopedRpcMigrations) {
  const fn = securityDefinerFunction(sql, name);
  assert.match(fn, /SECURITY (?:DEFINER|INVOKER)/, `${name} has an explicit execution security mode`);
  assert.match(fn, /auth\.uid\(\)/, `${name} derives the signed-in user`);
  assert.match(fn, /workspace_members/, `${name} checks workspace membership`);
  assert.match(fn, /workspace_id/, `${name} scopes authorization to a workspace`);
  assert.match(fn, /workspace not authorized|workspace selection required/, `${name} rejects unauthorized workspace access`);
}


// Historical boundary migration explicitly raised the implementation privilege
// for atomic writes. The final exposed wrappers are verified as SECURITY INVOKER
// by the H4.2 migration contract below.
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.confirm_product_activation_v2[\s\S]*SECURITY DEFINER/);
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.set_workspace_capabilities_v2[\s\S]*SECURITY DEFINER/);
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.create_offer_activation_v2[\s\S]*SECURITY DEFINER/);


// The later Stage 16 hardening intentionally makes these workspace-scoped
// activation functions SECURITY DEFINER; keep that privilege mode explicit.
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.confirm_product_activation_v2[\s\S]*SECURITY DEFINER/);
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.set_workspace_capabilities_v2[\s\S]*SECURITY DEFINER/);
assert.match(controlPlanePrivilegeMigration, /ALTER FUNCTION public\.create_offer_activation_v2[\s\S]*SECURITY DEFINER/);


// H4.2: authenticated activation RPCs keep stable public signatures, while the
// SECURITY DEFINER implementation lives outside the exposed API schema.
const h42Path = "supabase/migrations/20261011105000_h4_2_rpc_security_and_index_audit.sql";
const h42 = await readFile(h42Path, "utf8");
assert.match(h42, /GRANT USAGE ON SCHEMA private TO authenticated, service_role/);
const h42RpcHelpers = [
  ["confirm_product_activation_v2", "_activation_confirm_product_v2_impl", "UUID, TEXT, TEXT, TEXT, TEXT, JSONB"],
  ["create_network_offer_activation_v1", "_activation_create_network_offer_v1_impl", "UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]"],
  ["create_offer_activation_v2", "_activation_create_offer_v2_impl", "UUID, TEXT, TEXT, TEXT, TEXT, UUID[]"],
  ["set_moment_network_mapping_v1", "_activation_set_moment_network_mapping_v1_impl", "UUID, TEXT"],
  ["set_workspace_capabilities_v2", "_activation_set_workspace_capabilities_v2_impl", "UUID, TEXT[]"],
];
for (const [name, helper, args] of h42RpcHelpers) {
  assert.match(h42, new RegExp(`ALTER FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*SET SCHEMA private`), `${name} is moved out of public`);
  assert.match(h42, new RegExp(`ALTER FUNCTION private\\.${name}\\([\\s\\S]*?\\)\\s*RENAME TO ${helper}`), `${name} gets an internal implementation name`);
  assert.match(h42, new RegExp(`ALTER FUNCTION private\\.${helper}\\([^)]*\\)\\s*SET search_path = ''`), `${helper} pins an empty search_path`);
  const wrapper = securityDefinerFunction(h42, name);
  assert.match(wrapper, /SECURITY INVOKER/, `${name} public endpoint is invoker-mode`);
  assert.match(wrapper, new RegExp(`private\\.${helper}`), `${name} delegates to its private implementation`);
  assert.doesNotMatch(wrapper, /SECURITY DEFINER/, `${name} does not expose a definer wrapper`);
  assert.match(h42, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
  assert.match(h42, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[\\s\\S]*?TO authenticated, service_role`));
  assert.match(h42, new RegExp(`REVOKE ALL ON FUNCTION private\\.${helper}`));
  assert.match(h42, new RegExp(`GRANT EXECUTE ON FUNCTION private\\.${helper}[\\s\\S]*?TO authenticated, service_role`));
}
assert.match(h42, /DROP INDEX IF EXISTS private\.moment_occurrences_event_id_idx/);
assert.match(h42, /partial unique index on \(event_id\) WHERE event_id IS NOT NULL/i);


 // H4.3: a standalone settlement_id index is redundant because retained
 // unique indexes begin with settlement_id and preserve FK/query support.
const h43Path = "supabase/migrations/20261011110000_h4_3_redundant_financial_index.sql";
const h43 = await readFile(h43Path, "utf8");
assert.match(h43, /DROP INDEX IF EXISTS private\\.financial_entries_settlement_idx/);
assert.match(h43, /unique indexes start with settlement_id/i);

console.log("runtime hardening contract: OK");
