import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [home, onboarding, callback, state, confirm, capabilities, integrationCreate, integrationVerify, offers, migration] = await Promise.all([
  read("src/app/page.tsx"),
  read("src/app/onboarding/page.tsx"),
  read("src/app/auth/callback/route.ts"),
  read("src/app/api/onboarding/state/route.ts"),
  read("src/app/api/products/confirm/route.ts"),
  read("src/app/api/workspaces/capabilities/route.ts"),
  read("src/app/api/integrations/create/route.ts"),
  read("src/app/api/integrations/verify/route.ts"),
  read("src/app/api/offers/create/route.ts"),
  read("supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql"),
]);

assert.match(home, /\/onboarding\?url=/);
assert.doesNotMatch(home, /signInWithOAuth|router\.push\(["']\/login\?url=/);
assert.match(onboarding, /\/api\/analyze/);
assert.match(onboarding, /response\.status === 401/);
assert.match(onboarding, /sessionStorage/);
assert.match(onboarding, /workspace_id/);
assert.doesNotMatch(onboarding, /moment_1|moment_2/);
assert.match(callback, /pendingUrl/);
assert.match(callback, /auth_failed/);
assert.match(callback, /errorUrl\.searchParams\.set\("url", pendingUrl\)/);
assert.match(state, /workspace_selection_required/);
assert.match(state, /workspaces\.length === 1/);
assert.match(state, /requestedWorkspaceId/);
assert.match(confirm, /confirm_product_activation_v2/);
assert.match(confirm, /workspace_id/);
assert.match(capabilities, /set_workspace_capabilities_v2/);
assert.match(integrationCreate, /workspace_id/);
assert.match(integrationVerify, /workspace_id/);
assert.match(offers, /create_offer_activation_v2/);
assert.match(migration, /workspace selection required/);
assert.match(migration, /confirm_product_activation_v2/);
assert.match(migration, /set_workspace_capabilities_v2/);
assert.match(migration, /create_offer_activation_v2/);

console.log("stage16 activation contract: OK");
