import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [home, onboarding, callback, login, dashboard, globals, circleci, state, confirm, capabilities, integrationCreate, integrationVerify, offers, migration, initialWorkspaceMigration, databaseTypes] = await Promise.all([
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
  read("src/lib/stage16-database.types.ts"),
]);

assert.match(home, /\/onboarding\?url=/);
assert.doesNotMatch(home, /signInWithOAuth|router\.push\(["']\/login\?url=/);
assert.match(onboarding, /\/api\/analyze/);
assert.match(onboarding, /response\.status === 401/);
assert.match(onboarding, /sessionStorage/);
assert.match(onboarding, /workspace_id/);
assert.doesNotMatch(onboarding, /moment_1|moment_2/);
assert.match(onboarding, /draft && !state\\?\\.product \\? "product_understanding" : state\\?\\.step/);
assert.match(onboarding, /Issue new credential/);
assert.match(callback, /pendingUrl/);
assert.match(login, /: "\/dashboard"/);
assert.match(dashboard, /workspace_id: selectedWorkspaceId/);
assert.doesNotMatch(dashboard, /\.limit\(1\)/);
assert.match(globals, /\.input \{/);
assert.match(globals, /\.btn \{/);
assert.match(globals, /\.btn-secondary \{/);
assert.match(circleci, /stage16_activation_contract/);
assert.match(circleci, /npm run test:stage16-activation/);
assert.match(onboarding, /hasPendingProposal/);
assert.match(onboarding, /setDraft\(null\)/);
assert.match(callback, /auth_failed/);
assert.match(callback, /errorUrl\.searchParams\.set\("url", pendingUrl\)/);
assert.match(state, /workspace_selection_required/);
assert.match(state, /workspaces\.length === 1/);
assert.match(state, /requestedWorkspaceId/);
assert.match(confirm, /confirm_product_activation_v2/);
assert.match(confirm, /workspaceId \|\| null/);
assert.match(confirm, /workspace selection required/);
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
assert.match(initialWorkspaceMigration, /p_workspace_id UUID/);
assert.match(initialWorkspaceMigration, /p_workspace_id IS NULL/);
assert.match(initialWorkspaceMigration, /v_membership_count > 0/);
assert.match(initialWorkspaceMigration, /confirm_product_activation\(/);
assert.match(databaseTypes, /p_workspace_id: string \| null/);

console.log("stage16 activation contract: OK");
