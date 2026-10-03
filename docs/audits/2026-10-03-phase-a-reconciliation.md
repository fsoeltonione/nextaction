# NEXTACTION PHASE A RECONCILIATION REPORT

**Baseline Commit:** `260a796e2d0d957c472fb61d43d18ab5dcad49b5`
**Date:** 2026-10-03
**Status:** Discovery Complete. Ready for Phase B (Implementation).

---

## 1. SSRF-001: DNS TOCTOU in Product Scanner
**Status: PROVEN (P0)**
**Location:** `src/lib/product-scanner.ts` (lines 309-351)

**Analysis:**
The scanner performs three DNS checks: (1) pre-fetch validation, (2) actual fetch socket resolution, (3) post-fetch re-validation. The post-fetch check correctly catches a DNS rebind that *persists* after the fetch. However, because `fetchImpl` uses Cloudflare's native `fetch` while the pre/post checks use the Node.js compatibility `dns` module, they use independent resolvers. An attacker with a 0-TTL DNS server can return a public IP for checks 1 and 3, but a private IP precisely for the socket connection at check 2.

**Remediation Plan:**
Use Cloudflare's `cf: { resolveOverride: ip }` in the fetch options to force the Cloudflare native fetch to connect to the IP validated in step 1.

## 2. ECON-005: Missing UNIQUE Constraint on Settlements
**Status: STRONGLY INDICATED (P2 - Downgraded from P0)**
**Location:** `supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql`

**Analysis:**
A `UNIQUE INDEX` on `private.settlements(qualified_click_id)` does NOT exist in the database. However, the current code prevents duplicate settlements using a `FOR UPDATE` lock on the `qualified_clicks` row (line 75 of `runtime_settle_qualified_click`). Concurrent requests block and then correctly return `replayed`. The lack of a constraint is not currently exploitable, but it is technical debt that could silently break during future refactoring.

**Remediation Plan:**
Add a migration to create the missing `UNIQUE INDEX` as defense-in-depth.

## 3. ECON-003: Qualify + Settle in Separate RPCs
**Status: PROVEN (P1)**
**Location:** `src/app/v1/click/[delivery_token]/route.ts` (lines 126, 215)

**Analysis:**
The click handler executes `runtime_record_and_qualify_click` (Tx1) and `runtime_settle_qualified_click` (Tx2) as two separate HTTP REST calls to Supabase. If the Cloudflare Worker crashes between the two calls, the click is marked `qualified` but never settled. The user's browser will not auto-retry a redirected GET request. This causes unrecoverable revenue leakage for the publisher.

**Remediation Plan:**
Create a new wrapper RPC that executes both functions within a single atomic database transaction, and update the route to call it.

## 4. ECON-004: Delivery Capacity Race
**Status: NOT A BUG / INTENTIONAL DESIGN (P3)**
**Location:** `supabase/migrations/20260926040000_stage_9_hardening.sql`

**Analysis:**
The `runtime_create_decision_delivery` function uses a snapshot read for advertiser capacity. If capacity is exhausted between delivery and click, `runtime_settle_qualified_click` handles it gracefully and returns `no_capacity` (HTTP 503). This is explicitly documented in the API Contract Truth as the intended behavior (capacity is consumed at settlement, not reserved at delivery).

**Remediation Plan:**
No code changes required. The intentional design should be highlighted in documentation.

## 5. DASH-001: Hardcoded Balance
**Status: PROVEN (P0)**
**Location:** `src/app/dashboard/page.tsx` (line 305)

**Analysis:**
The dashboard displays a hardcoded `<span className="text-emerald-400 font-semibold">$25.00</span>`. The UI uses the anon Supabase client, which cannot read `private.advertiser_credit_accounts` due to RLS policies.

**Remediation Plan:**
Create a server component or server-side API route (using the service_role key or an explicitly granted view) to securely fetch and display the actual workspace balance.

## 6. DASH-002: offer_moments Leak
**Status: PROVEN (P2)**
**Location:** `src/app/dashboard/page.tsx` (line 100)

**Analysis:**
The client queries `offer_moments` without a workspace filter. The table lacks RLS read protections (`GRANT SELECT TO authenticated`). This exposes UUID associations for other workspaces' targeting configurations, even though the actual offer/moment details remain protected.

**Remediation Plan:**
Apply an `.in('offer_id', [...])` filter in the client to fetch only rows belonging to the already-authorized offers.

## 7. CICD-001: Production Branch Governance
**Status: STRONGLY INDICATED (P2)**
**Location:** `.circleci/config.yml`

**Analysis:**
The CI configuration explicitly validates `NEXTACTION_RELEASE_BRANCH` and uses branch filters appropriately. The codebase itself does everything correctly. The only gap is external: GitHub branch protection rules (requiring PRs and blocking direct pushes) cannot be enforced or verified from the codebase.

**Remediation Plan:**
Document the required external GitHub branch protection settings. The code configuration is already correct.

## 8. MIGR-001: First-Workspace RLS Bootstrap
**Status: TECHNICAL DEBT / INTENTIONAL (P3)**
**Location:** `supabase/migrations/20260928193000_stage_16_first_workspace_rls_bootstrap.sql`

**Analysis:**
The zero-workspace activation uses a `SECURITY DEFINER` function to bypass RLS during the initial workspace creation. This is a carefully constructed and safe bootstrap pattern using an advisory lock. It works correctly and does not break security boundaries.

**Remediation Plan:**
No code changes required. The pattern is safe and verified.

## 9. TEST-001: Production Smoke Bypasses HTTP
**Status: PROVEN (P1)**
**Location:** `scripts/production-smoke.mjs`

**Analysis:**
The production smoke test calls an internal DB RPC (`production_runtime_smoke`) instead of exercising the actual Cloudflare Worker HTTP endpoints. This leaves the worker routing, environment bindings, and HTTP parsing untested in production.

**Remediation Plan:**
Adapt the staging smoke test (which uses real HTTP calls) into the production script. To prevent permanent fixtures, the test should dynamically provision ephemeral workspace/integration data and include a teardown step, or rely on a dedicated "test mode" header recognized by the worker to bypass financial writes.
