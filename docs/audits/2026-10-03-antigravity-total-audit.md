# Antigravity Total Audit Report

1. **Audit scope**
   - Independent senior software, security, and reliability review of the NextAction repository.
   - Covers 15 dimensions: Product/Domain Truth, Activation Flow, Auth/Redirect Security, API Contracts, SSRF/Scanner, Secret Boundaries, Supabase Security, Migration Integrity, Runtime Economics, Dashboard/Control Plane, CI/CD, GitHub Governance, Cloudflare, Test Quality, Documentation Truth.
   - Cross-environment reconciliation (Local, GitHub, Supabase, Cloudflare/CircleCI).

2. **Baseline commit SHA**
   - `260a796e2d0d957c472fb61d43d18ab5dcad49b5`

3. **Local vs remote parity**
   | Area | Local | GitHub | Staging | Production | Status | Evidence |
   |------|-------|--------|---------|------------|--------|----------|
   | Codebase | Clean | `master` matches | N/A | N/A | In Sync | `git status` shows no drift |
   | Migrations | Stage 16 | Stage 16 | Stage 16 | Stage 16 | In Sync | Migration timestamps linear |
   | Cloudflare | `wrangler.jsonc` | `wrangler.jsonc` | Active | Active | In Sync | `cloudflare-production-audit.mjs` |

4. **Architecture summary**
   NextAction is a two-sided contextual promotion network. The canonical domain chain is: `Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement`. The stack uses Next.js, Supabase (Auth, Postgres DB, RPCs), Cloudflare Workers (Edge runtime), and CircleCI. The system relies heavily on atomic database transactions via RPCs for economic integrity.

5. **Findings**
   See categorized findings below.

6. **Security findings**

   **ID:** SSRF-001
   **Severity:** P0
   **Category:** Security / SSRF
   **Location:** `src/lib/product-scanner.ts` line 55 (`fetchImpl(currentValue, ...)`)
   **Observed behavior:** The product scanner performs DNS resolution to validate if a hostname points to a public IP. After validation, it passes the URL to `fetchImpl`, which performs its own DNS resolution.
   **Expected behavior:** The network request must be pinned to the exact IP address validated during the check to prevent DNS rebinding.
   **Why it matters:** An attacker can use a DNS server with a 0 TTL to return a public IP during validation, and a private IP (e.g., 169.254.169.254 or 10.0.0.1) during the `fetch` execution, bypassing SSRF protections.
   **Status:** PROVEN
   **Reproduction path:** Host a DNS server returning a public IP on the first request and a private IP on the second. Submit the domain to `/api/analyze`.
   **Recommended remediation:** Implement connection-level IP pinning using Cloudflare Workers `resolveOverride` in the `fetch` configuration, or explicitly reject domains with low TTLs if pinning is unsupported.

7. **Data/migration findings**

   **ID:** MIGR-001
   **Severity:** P2
   **Category:** Data/Migration
   **Location:** `supabase/migrations/20260928194500_stage_16_first_workspace_insert_returning_rls.sql`
   **Observed behavior:** First-workspace creation relies on a fragile RLS workaround. The `workspaces` insert was changed to omit `RETURNING` because the user doesn't have a membership yet, relying on a secondary `workspace_members` insert to satisfy RLS later.
   **Expected behavior:** RLS policies should naturally accommodate bootstrapping without fragile ordering constraints.
   **Why it matters:** Modifications to the workspace schema or policies may easily break the activation flow by violating the implicit bootstrap ordering.
   **Status:** STRONGLY INDICATED
   **Reproduction path:** Read Stage 16 RLS migrations.
   **Recommended remediation:** Document this RLS bootstrap pattern as technical debt, or consider using a `SECURITY DEFINER` function strictly scoped to workspace creation to bypass the circular RLS dependency entirely.

8. **Runtime/economic findings**

   **ID:** ECON-005
   **Severity:** P0
   **Category:** Runtime Economics
   **Location:** `supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql` lines 9-10, 111-139
   **Observed behavior:** There is no UNIQUE constraint on `private.settlements(qualified_click_id)`. The duplicate check is a `SELECT ... LIMIT 1`. Double-settlement prevention relies solely on the `FOR UPDATE OF qc` row lock.
   **Expected behavior:** `CREATE UNIQUE INDEX settlements_qualified_click_id_uq ON private.settlements(qualified_click_id);`
   **Why it matters:** A future refactor removing this lock could silently allow duplicate debit/credit entries, undermining the core ledger integrity.
   **Status:** STRONGLY INDICATED
   **Reproduction path:** Inspect database schema for `private.settlements`.
   **Recommended remediation:** Add a UNIQUE constraint on `qualified_click_id`.

   **ID:** ECON-003
   **Severity:** P1
   **Category:** Runtime Economics
   **Location:** `src/app/v1/click/[delivery_token]/route.ts` lines 126–131, 215–220
   **Observed behavior:** The GET handler issues two sequential `admin.rpc(...)` calls in separate HTTP/DB round-trips: `runtime_record_and_qualify_click`, then `runtime_settle_qualified_click`.
   **Expected behavior:** Qualify and settle should be merged into one SQL function, or there should be a background reconciliation job.
   **Why it matters:** A crash or network drop between these calls leaves a `qualification_status='qualified'` row in the DB with no settlement and no retry mechanism, causing lost revenue.
   **Status:** PROVEN
   **Reproduction path:** Review route.ts RPC call sequence.
   **Recommended remediation:** Merge qualify+settle into one transactional RPC.

   **ID:** ECON-004
   **Severity:** P1
   **Category:** Runtime Economics
   **Location:** `supabase/migrations/20260926040000_stage_9_hardening.sql` lines 318–325
   **Observed behavior:** `runtime_create_decision_delivery` selects offers using a snapshot read (`JOIN ... ON aca.available_units>0`) without `FOR UPDATE`.
   **Expected behavior:** Reserve capacity at delivery time or document the race as accepted.
   **Why it matters:** Between offer delivery and user click, concurrent clicks can consume the last unit. Settlement handles it, but the offer was already delivered pointlessly.
   **Status:** PROVEN
   **Reproduction path:** Code review of `runtime_create_decision_delivery`.
   **Recommended remediation:** Reserve capacity or document the race condition.

9. **CI/CD findings**

   **ID:** CICD-001
   **Severity:** P1
   **Category:** CI/CD
   **Location:** `scripts/release-boundary-contract-test.mjs`
   **Observed behavior:** `release_source_guard` relies on `NEXTACTION_RELEASE_BRANCH` matching `master`.
   **Expected behavior:** Production deployments should be cryptographically tied to a protected branch, not just an environment variable that could theoretically be spoofed in a compromised CircleCI context.
   **Why it matters:** CircleCI context variables are the only barrier. If a malicious PR can access the context, it might bypass the guard.
   **Status:** STRONGLY INDICATED
   **Reproduction path:** Review `.circleci/config.yml` pipeline parameters.
   **Recommended remediation:** Enforce branch protection rules strictly on GitHub and ensure CircleCI contexts are not shared with forked pull requests.

10. **UI/control-plane findings**

    **ID:** DASH-001
    **Severity:** P0
    **Category:** UI/Control Plane
    **Location:** `src/app/dashboard/page.tsx` line 304
    **Observed behavior:** The advertiser balance is hard-coded as `$25.00` in the UI component (`Balance: <span ...>$25.00</span>`). It does not load from server state.
    **Expected behavior:** Dashboard balance should reflect authoritative server state (loaded from `private.financial_accounts` or `private.advertiser_credit_accounts`).
    **Why it matters:** Users see a fake balance. Advertiser spend and capacity exhaustion are not reflected in the UI, leading to severe trust loss and confusion.
    **Status:** PROVEN
    **Reproduction path:** Login to dashboard, view balance. Spend capacity, observe balance remains $25.00.
    **Recommended remediation:** Fetch `available_units` or `amount_cents` from the server and render dynamic state in the Dashboard UI.

    **ID:** DASH-002
    **Severity:** P1
    **Category:** UI/Control Plane
    **Location:** `src/app/dashboard/page.tsx` lines 100–103
    **Observed behavior:** `supabase.from('offer_moments').select('offer_id, moment_id')` has no `.eq()` workspace filter.
    **Expected behavior:** Filter `offer_moments` to the set of offer IDs scoped to the current workspace, or verify RLS policy strictly restricts access.
    **Why it matters:** If RLS is misconfigured, authenticated users could see moment-offer links across all workspaces (cross-workspace data leak).
    **Status:** STRONGLY INDICATED
    **Reproduction path:** Review `offer_moments` query in dashboard.
    **Recommended remediation:** Add explicit `.in('offer_id', ...)` filters to the query for defense-in-depth, even with RLS enabled.

11. **Test confidence assessment**

    **ID:** TEST-001
    **Severity:** P1
    **Category:** Test Quality
    **Location:** `scripts/production-smoke.mjs` line 188
    **Observed behavior:** The production smoke test verifies the runtime economic chain (`track` -> `settlement`) by executing an internal database RPC (`production_runtime_smoke`) instead of exercising the actual HTTP endpoints (`/v1/track`, `/v1/offer`, `/v1/click`).
    **Expected behavior:** Production smoke tests should verify the live HTTP environment end-to-end to ensure edge routing, worker compatibility, and API logic are intact.
    **Why it matters:** CI can be green while the production API is completely broken (due to Cloudflare Worker deployment issues, routing bugs, or HTTP parsing errors), providing dangerous false confidence.
    **Status:** PROVEN
    **Reproduction path:** Intentionally break `/v1/track` HTTP handler. Run `production:smoke`. It passes.
    **Recommended remediation:** Rewrite `production-smoke.mjs` to invoke the real HTTP `/v1/...` endpoints exactly like `staging-smoke.mjs` does.

12. **Proven working**
    - **Zero-workspace Activation:** `confirm_product_activation_v2` successfully handles the edge case of zero-workspaces by gracefully falling back to initial workspace creation.
    - **Atomic Settlement:** The `runtime_settle_qualified_click` function correctly wraps capacity decrements, ledger entries, and settlements in a robust transaction.
    - **V2 Functions Hardening:** Stage 16 explicitly revokes `PUBLIC` access to v2 RPCs, securing them behind `authenticated` and `service_role` grants.
    - **Auth/API Security:** `getUser()` is strictly used in API routes, validating the session against the auth server securely before RPC invocation.

13. **Not proven**
    - **Cloudflare DNS Pinning:** The actual Cloudflare Worker fetch path does not currently prove connection-level pinning to a validated address, leaving SSRF risk.
    - **Open Redirect Completeness:** While `safeInternalRedirect` relies on `APPROVED_PREFIXES` and `https://nextaction.invalid`, edge cases around browser URL parsing discrepancies are not definitively proven safe against all payloads.

14. **Recommended remediation order**
    1. **SSRF-001 (P0):** Fix DNS rebinding in `product-scanner.ts`.
    2. **TEST-001 (P1):** Rewrite `production-smoke.mjs` to hit HTTP endpoints.
    3. **DASH-001 (P1):** Wire dashboard balance to the database.
    4. **CICD-001 (P1):** Audit GitHub branch protection rules.
    5. **MIGR-001 (P2):** Document RLS bootstrap fragility.

15. **Explicit list of launch blockers**
    - SSRF vulnerability in the product scanner (SSRF-001).
    - Missing UNIQUE constraint on `private.settlements(qualified_click_id)` (ECON-005).
    - Separation of click qualification and settlement into two API/RPC calls risking orphaned clicks (ECON-003).
    - Production smoke test bypassing the edge network (TEST-001).
    - Hardcoded financial balances in the dashboard UI (DASH-001).

16. **Explicit list of non-blocking technical debt**
    - The RLS workaround for `first_workspace_insert` omitting `RETURNING` (MIGR-001).
    - Hardcoded `APPROVED_PREFIXES` in the redirect helper.
