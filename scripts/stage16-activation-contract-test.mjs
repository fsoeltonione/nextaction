import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [home, onboarding, callback, login, dashboard, globals, circleci, state, confirm, capabilities, integrationCreate, integrationVerify, offers, migration, initialWorkspaceMigration, privilegeMigration, privateDenyMigration, workspaceScopeMigration, initialWorkspaceContextFix, databaseTypes] = await Promise.all([
  read("src/app/page.tsx"),
  read("src/app/onboarding/page.tsx"),
  read("src/app/auth/callback/route.ts"),
  read("src/app/login/page.tsx"),
  read("src/app/dashboard/page.tsx"),
  read("src/app/globals.css"),
  read(".circleci/config.yml"),
  read("src/app/api/onboarding/state/route.ts"),
  read("src/app/api/products/confirm/route.ts"),
  read("src/app/api/workspaces/capabilities/route.ts"),
  read("src/app/api/integrations/create/route.ts"),
  read("src/app/api/integrations/verify/route.ts"),
  read("src/app/api/offers/create/route.ts"),
  read("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql"),
  read("supabase/migrations/20260928061500_stage_16_initial_workspace_creation.sql"),
  read("supabase/migrations/20260928180000_stage_16_v2_function_privilege_hardening.sql"),
  read("supabase/migrations/20260928180500_stage_16_private_table_deny_policies.sql"),
  read("supabase/migrations/20260928183000_stage_16_v2_workspace_scope_qualification.sql"),
  read("supabase/migrations/20260928185000_stage_16_v2_initial_workspace_context_fix.sql"),
  read("src/lib/stage16-database.types.ts"),
]);

assert.match(home, /\/onboarding\?url=/);
assert.doesNotMatch(home, /signInWithOAuth|router\.push\(["']\/login\?url=/);
assert.match(onboarding, /\/api\/analyze/);
assert.match(onboarding, /response\.status === 401/);
assert.match(onboarding, /sessionStorage/);
assert.match(onboarding, /workspace_id/);
assert.doesNotMatch(onboarding, /moment_1|moment_2/);
assert.match(onboarding, /hasPendingProposal/);
assert.match(onboarding, /initialWorkspaceId/);
assert.match(onboarding, /selectedWorkspaceId \? "&workspace_id="/);
assert.match(dashboard, /\/onboarding\?workspace_id=/);
assert.match(onboarding, /state\.capabilities\.includes\("make_money"\)/);
assert.match(onboarding, /state\.capabilities\.includes\("reach_customers"\)/);
assert.match(onboarding, /Issue new credential/);
assert.match(callback, /pendingUrl/);
assert.match(login, /pendingWorkspaceId/);
assert.match(login, /: "\/dashboard"/);
assert.match(dashboard, /workspace_id: selectedWorkspaceId/);
assert.doesNotMatch(dashboard, /\.limit\(1\)/);
assert.match(globals, /\.input \{/);
assert.match(globals, /\.btn \{/);
assert.match(globals, /\.btn-secondary \{/);
assert.match(circleci, /stage16_activation_contract/);
assert.match(circleci, /npm run test:stage16-activation/);
assert.match(circleci, /deploy_staging:[\s\S]*?stage16_activation_contract/);
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
assert.match(integrationVerify, /workspace_id/);
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
assert.match(databaseTypes, /p_workspace_id: string \| null/);

console.log("stage16 activation contract: OK");
