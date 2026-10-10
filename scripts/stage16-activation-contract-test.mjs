import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [home, onboarding, callback, login, dashboard, globals, qualityWorkflow, qualityGatesWorkflow, releaseWorkflow, state, confirm, capabilities, integrationCreate, integrationVerify, runtimeConnectionVerify, offers, migration, initialWorkspaceMigration, privilegeMigration, privateDenyMigration, firstWorkspaceRlsMigration, firstWorkspaceReturningRlsMigration, atomicIntegrationCredentialMigration, atomicIntegrationCredentialVerificationMigration, readOnlyControlPlaneMigration, databaseTypes, cloudflareBuild, cloudflareCheck, anonymousAcceptanceScript, momentKeyMigration] = await Promise.all([
  read("src/app/page.tsx"),
  read("src/app/onboarding/page.tsx"),
  read("src/app/auth/callback/route.ts"),
  read("src/app/login/page.tsx"),
  read("src/app/dashboard/page.tsx"),
  read("src/app/globals.css"),
  read(".github/workflows/quality.yml"),
  read(".github/workflows/quality-gates.yml"),
  read(".github/workflows/release.yml"),
  read("src/app/api/onboarding/state/route.ts"),
  read("src/app/api/products/confirm/route.ts"),
  read("src/app/api/workspaces/capabilities/route.ts"),
  read("src/app/api/integrations/create/route.ts"),
  read("src/app/api/integrations/verify/route.ts"),
  read("src/app/v1/connection/verify/route.ts"),
  read("src/app/api/offers/create/route.ts"),
  read("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql"),
  read("supabase/migrations/20260928061500_stage_16_initial_workspace_creation.sql"),
  read("supabase/migrations/20260928180000_stage_16_v2_function_privilege_hardening.sql"),
  read("supabase/migrations/20260928180500_stage_16_private_table_deny_policies.sql"),
  read("supabase/migrations/20260928193000_stage_16_first_workspace_rls_bootstrap.sql"),
  read("supabase/migrations/20260928194500_stage_16_first_workspace_insert_returning_rls.sql"),
  read("supabase/migrations/20260928233000_stage_16_atomic_integration_credential_provisioning.sql"),
  read("supabase/migrations/20260929000500_stage_16_private_credential_verification_boundary.sql"),
  read("supabase/migrations/20260929010000_stage_16_read_only_control_plane.sql"),
  read("src/lib/stage16-database.types.ts"),
  read("scripts/cloudflare-vinext-build.mjs"),
  read("scripts/cloudflare-vinext-check.mjs"),
  read("scripts/staging-anonymous-proposal-acceptance.mjs"),
  read("supabase/migrations/20261011010000_stage_16_moment_key_semantics.sql"),
]);

assert.match(home, /\/onboarding\?url=/);
assert.doesNotMatch(home, /signInWithOAuth|router\.push\(["']\/login\?url=/);
assert.match(anonymousAcceptanceScript, /api\/onboarding\/state/);
assert.match(anonymousAcceptanceScript, /Confirm product understanding/);
assert.match(anonymousAcceptanceScript, /confirmResponse\.status\(\)/);
assert.match(anonymousAcceptanceScript, /assert\.equal\([\s\S]*?confirmResponse\.status\(\),[\s\S]*?401/);
assert.match(anonymousAcceptanceScript, /loginUrl\.searchParams\.get\("url"\)/);
assert.match(anonymousAcceptanceScript, /Staging anonymous URL-first proposal acceptance: PASS/);

assert.match(onboarding, /\/api\/analyze/);assert.match(onboarding, /import \{ normalizeProductUrl \} from "@\/lib\/url";/);
assert.match(onboarding, /const \[hostname, setHostname\] = useState\(\(\) =>/);
assert.match(onboarding, /const \[isValidUrl, setIsValidUrl\] = useState\(\(\) =>/);
assert.match(onboarding, /function handleUrlChange\(value: string\)/);
assert.match(onboarding, /normalizeProductUrl\(value\)/);
assert.match(onboarding, /s2\.googleusercontent\.com\/s2\/favicons\?domain=/);assert.match(onboarding, /pointer-events-none absolute left-4/);
assert.match(onboarding, /w-full rounded-2xl border bg-neutral-900 py-4 pl-12 pr-4/);

assert.match(onboarding, /Enter a public HTTP or HTTPS SaaS URL\./);
assert.match(onboarding, /disabled=\{!isValidUrl \|\| analysisRunning\}/);

assert.match(onboarding, /response\.status === 401/);
assert.match(onboarding, /sessionStorage/);
assert.match(onboarding, /workspace_id/);
assert.match(onboarding, /isMeaningfulMomentKey/);
assert.match(onboarding, /Generic placeholders/);
assert.match(onboarding, /key: "", label: "", description: ""/);
assert.match(confirm, /isMeaningfulMomentKey/);
assert.ok(momentKeyMigration.includes("CREATE OR REPLACE FUNCTION private.guard_moment_key_semantics"));
assert.ok(momentKeyMigration.includes("CREATE TRIGGER moments_semantic_key_guard"));
assert.ok(momentKeyMigration.includes("BEFORE INSERT OR UPDATE OF moment_key ON public.moments"));
assert.ok(momentKeyMigration.includes("'new', 'temp', 'thing', 'foo'"));
assert.match(onboarding, /hasPendingProposal/);
assert.match(onboarding, /initialWorkspaceId/);
assert.match(onboarding, /const loadStateRequestRef = useRef\(0\)/);
assert.match(onboarding, /const requestSequence = \+\+loadStateRequestRef\.current/);
assert.match(onboarding, /if \(requestSequence !== loadStateRequestRef\.current\) return null/);
assert.match(onboarding, /if \(loading \|\| !urlInput \|\| draft \|\| analysisRunning \|\| autoAnalysisUrlRef\.current === urlInput\) return/);
assert.match(onboarding, /if \(state\?\.product\?\.canonical_url === urlInput\) return/);
assert.match(onboarding, /autoAnalysisUrlRef\.current = draft\.url/);
assert.match(onboarding, /const nextState = await loadState\(selectedWorkspaceId\)/);
assert.match(onboarding, /if \(!nextState\) throw new Error\("Unable to load activation state after confirming the product\."/);
assert.match(onboarding, /const nextState = await loadState\(selectedWorkspaceId\);[\s\S]*?clearPending\(\);[\s\S]*?setDraft\(null\);/);
assert.match(onboarding, /if \(nextState\.step !== "product_understanding"\) return null/);
assert.doesNotMatch(onboarding, /setState\(\(current\) => current \? \{ \.\.\.current, step: "product_understanding"/);
assert.match(onboarding, /disabled=\{analysisRunning\}/);
assert.match(onboarding, /selectedWorkspaceId \? "&workspace_id="/);
assert.match(dashboard, /\/onboarding\?workspace_id=/);
assert.match(dashboard, /\/onboarding\?workspace_id=.*&mode=add_product/);
assert.match(dashboard, /\/onboarding\?mode=add_product/);
assert.match(onboarding, /searchParams\.get\("mode"\) === "add_product"/);
assert.match(onboarding, /initialFlowUrl/);
assert.match(onboarding, /initialFlowDraft/);
assert.match(onboarding, /if \(isAddProductMode\) return currentDraft/);
assert.match(onboarding, /isAddProductMode \? "url" : state\?\.step/);
assert.match(onboarding, /&mode=add_product/);
assert.match(onboarding, /if \(isAddProductMode\) \{[\s\S]*?router\.replace\("\/dashboard\?workspace_id=/);
assert.match(login, /const pendingMode = searchParams\.get\("mode"\)/);
assert.match(login, /pendingMode === "add_product"/);
assert.match(callback, /const pendingMode = safeNextUrl\.searchParams\.get\("mode"\)/);
assert.match(callback, /pendingMode === "add_product"/);
assert.match(onboarding, /state\.capabilities\.includes\("make_money"\)/);
assert.match(onboarding, /state\.capabilities\.includes\("reach_customers"\)/);
assert.match(onboarding, /capabilitySelection\.length === 2 \? "rounded-2xl border border-white bg-white\/10 p-5 text-left" : "rounded-2xl border border-neutral-800 p-5 text-left"/);
assert.match(onboarding, /Issue new credential/);
assert.match(callback, /pendingUrl/);
assert.match(login, /pendingWorkspaceId/);
assert.match(login, /: "\/dashboard"/);
assert.match(dashboard, /workspace_id: selectedWorkspaceId/);
assert.doesNotMatch(dashboard, /\.limit\(1\)/);
assert.match(globals, /\.input \{/);
assert.match(globals, /\.btn \{/);
assert.match(globals, /\.btn-secondary \{/);
assert.match(qualityWorkflow, /^  quality_gates:/m);
assert.match(qualityWorkflow, /uses: \.\/\.github\/workflows\/quality-gates\.yml/);
assert.match(qualityGatesWorkflow, /^  stage16_activation_contract:/m);
assert.match(qualityGatesWorkflow, /npm run test:stage16-activation/);
assert.match(releaseWorkflow, /^  quality_gates:/m);
assert.match(releaseWorkflow, /deploy_staging:[\s\S]*?quality_gates/);
assert.match(onboarding, /hasPendingProposal/);
assert.match(onboarding, /setDraft\(null\)/);
assert.match(callback, /auth_failed/);
assert.match(callback, /pendingWorkspaceId/);
assert.match(callback, /errorUrl\.searchParams\.set\("url", pendingUrl\)/);
assert.match(callback, /errorUrl\.searchParams\.set\("workspace_id", pendingWorkspaceId\)/);
assert.match(state, /workspace_selection_required/);
assert.match(state, /workspaces\.length === 1/);
assert.match(state, /requestedWorkspaceId/);
assert.match(confirm, /confirm_product_activation_v2/);
assert.match(confirm, /workspaceId \|\| null/);
assert.match(confirm, /workspace_selection_required/);
assert.match(capabilities, /set_workspace_capabilities_v2/);
assert.match(integrationCreate, /workspace_id/);
assert.match(integrationCreate, /provision_integration_credential_v2/);
assert.doesNotMatch(integrationCreate, /schema\(["']private["']\)/);
assert.match(integrationVerify, /integration_id/);
assert.match(integrationVerify, /last_seen_at/);
assert.doesNotMatch(integrationVerify, /resolve_integration_credential_v2/);
assert.doesNotMatch(integrationVerify, /\.update\(/);
assert.match(runtimeConnectionVerify, /resolveRuntimeIntegration/);
assert.match(runtimeConnectionVerify, /runtime:connection-verify/);
assert.match(runtimeConnectionVerify, /last_seen_at/);
assert.match(runtimeConnectionVerify, /verified: true/);
assert.doesNotMatch(runtimeConnectionVerify, /runtime_accept_event/);
assert.doesNotMatch(runtimeConnectionVerify, /Access-Control-Allow-Origin/);
assert.doesNotMatch(onboarding, /function verifyIntegration/);
assert.equal(onboarding.includes('fetch("/api/integrations/verify"'), false);
assert.match(onboarding, /NEXTACTION_API_BASE_URL/);
assert.match(onboarding, /NEXTACTION_INTEGRATION_TOKEN/);
assert.match(onboarding, /Copy credential/);
assert.match(onboarding, /Copy server code/);
assert.match(offers, /create_offer_activation_v2/);
assert.match(offers, /reach_customers/);
assert.match(migration, /workspace selection required/);
assert.match(migration, /confirm_product_activation_v2/);
assert.match(migration, /set_workspace_capabilities_v2/);
assert.match(migration, /create_offer_activation_v2/);
assert.match(migration, /reach customers capability not selected/);
assert.match(migration, /workspace_capabilities wc/);
assert.match(migration, /RETURNS TABLE \(result_workspace_id UUID, result_product_id UUID, result_moment_count INTEGER\)/);
assert.match(migration, /RETURNS TABLE \(result_workspace_id UUID, result_capability TEXT\)/);
assert.match(migration, /RETURNS TABLE \(result_workspace_id UUID, result_offer_id UUID, result_moment_count INTEGER\)/);
assert.match(dashboard, /target_moment_ids: \[\.\.\.offerForm\.moment_ids\]/);
assert.match(initialWorkspaceMigration, /p_workspace_id UUID/);
assert.match(initialWorkspaceMigration, /p_workspace_id IS NULL/);
assert.match(initialWorkspaceMigration, /v_membership_count > 0/);
assert.match(initialWorkspaceMigration, /confirm_product_activation\(/);
assert.match(privilegeMigration, /REVOKE ALL ON FUNCTION public\.confirm_product_activation_v2/);
assert.match(privilegeMigration, /FROM PUBLIC, anon/);
assert.match(privilegeMigration, /GRANT EXECUTE ON FUNCTION public\.confirm_product_activation_v2[\s\S]*?TO authenticated/);
assert.match(privilegeMigration, /REVOKE ALL ON FUNCTION public\.set_workspace_capabilities_v2/);
assert.match(privilegeMigration, /REVOKE ALL ON FUNCTION public\.create_offer_activation_v2/);
assert.match(privateDenyMigration, /ON private\.advertiser_credit_accounts/);
assert.match(privateDenyMigration, /ON private\.advertiser_credit_entries/);
assert.match(privateDenyMigration, /ON private\.clicks/);
assert.match(privateDenyMigration, /ON private\.decisions/);
assert.match(privateDenyMigration, /ON private\.deliveries/);
assert.match(privateDenyMigration, /ON private\.events/);
assert.match(privateDenyMigration, /ON private\.financial_accounts/);
assert.match(privateDenyMigration, /ON private\.financial_entries/);
assert.match(privateDenyMigration, /ON private\.integration_secrets/);
assert.match(privateDenyMigration, /ON private\.moment_occurrences/);
assert.match(privateDenyMigration, /ON private\.qualified_clicks/);
assert.match(privateDenyMigration, /ON private\.rate_limit_buckets/);
assert.match(privateDenyMigration, /ON private\.settlements/);
assert.match(privateDenyMigration, /FOR ALL[\s\S]*?TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/);
assert.match(firstWorkspaceRlsMigration, /CREATE OR REPLACE FUNCTION private\.is_current_user_workspace_creator/);
assert.match(firstWorkspaceRlsMigration, /SECURITY DEFINER/);
assert.match(firstWorkspaceRlsMigration, /DROP POLICY IF EXISTS workspace_members_insert/);
assert.match(firstWorkspaceRlsMigration, /private\.is_current_user_workspace_creator\(workspace_id\)/);
assert.doesNotMatch(firstWorkspaceRlsMigration, /CREATE POLICY workspace_select_created_by_self/);
assert.match(atomicIntegrationCredentialMigration, /CREATE OR REPLACE FUNCTION public\.provision_integration_credential_v2/);
assert.match(atomicIntegrationCredentialMigration, /SECURITY DEFINER/);
assert.match(atomicIntegrationCredentialMigration, /private\.integration_secrets/);
assert.match(atomicIntegrationCredentialMigration, /pg_advisory_xact_lock/);
assert.match(atomicIntegrationCredentialMigration, /FOR UPDATE/);
assert.match(atomicIntegrationCredentialMigration, /REVOKE ALL ON FUNCTION public\.provision_integration_credential_v2[\s\S]*FROM PUBLIC/);
assert.match(atomicIntegrationCredentialMigration, /REVOKE ALL ON FUNCTION public\.provision_integration_credential_v2[\s\S]*FROM anon/);
assert.match(atomicIntegrationCredentialMigration, /REVOKE ALL ON FUNCTION public\.provision_integration_credential_v2[\s\S]*FROM authenticated/);
assert.match(atomicIntegrationCredentialMigration, /GRANT EXECUTE ON FUNCTION public\.provision_integration_credential_v2[\s\S]*TO service_role/);
assert.match(atomicIntegrationCredentialVerificationMigration, /CREATE OR REPLACE FUNCTION public\.resolve_integration_credential_v2/);
assert.match(atomicIntegrationCredentialVerificationMigration, /SECURITY DEFINER/);
assert.match(atomicIntegrationCredentialVerificationMigration, /private\.integration_secrets/);
assert.match(atomicIntegrationCredentialVerificationMigration, /REVOKE ALL ON FUNCTION public\.resolve_integration_credential_v2/);
assert.match(atomicIntegrationCredentialVerificationMigration, /GRANT EXECUTE ON FUNCTION public\.resolve_integration_credential_v2[\s\S]*TO service_role/);
assert.match(readOnlyControlPlaneMigration, /ALTER FUNCTION public\.confirm_product_activation_v2[\s\S]*SECURITY DEFINER/);
assert.match(readOnlyControlPlaneMigration, /ALTER FUNCTION public\.set_workspace_capabilities_v2[\s\S]*SECURITY DEFINER/);
assert.match(readOnlyControlPlaneMigration, /ALTER FUNCTION public\.create_offer_activation_v2[\s\S]*SECURITY DEFINER/);
assert.match(readOnlyControlPlaneMigration, /REVOKE ALL ON TABLE[\s\S]*public\.offer_moments[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(readOnlyControlPlaneMigration, /GRANT SELECT ON TABLE[\s\S]*public\.offer_moments\s+TO authenticated/);
assert.match(readOnlyControlPlaneMigration, /REVOKE ALL ON FUNCTION public\.confirm_product_activation\(/);
assert.match(readOnlyControlPlaneMigration, /REVOKE ALL ON FUNCTION public\.set_workspace_capabilities\(/);
assert.match(readOnlyControlPlaneMigration, /REVOKE ALL ON FUNCTION public\.create_offer_activation\(/);
assert.match(cloudflareBuild, /typescript-eslint@8\.70\.1/);
assert.match(cloudflareCheck, /typescript-eslint@8\.70\.1/);
assert.match(databaseTypes, /p_workspace_id: string \| null/);

assert.match(
  firstWorkspaceReturningRlsMigration,
  /v_workspace_id := extensions\.gen_random_uuid\(\);[\s\S]*INSERT INTO public\.workspaces \(id, name, user_id, created_by\)/
);
assert.doesNotMatch(firstWorkspaceReturningRlsMigration, /RETURNING id INTO v_workspace_id/);
assert.match(firstWorkspaceReturningRlsMigration, /pg_advisory_xact_lock\(hashtextextended\(v_user_id::text, 0\)\)/);

console.log("stage16 activation contract: OK");
