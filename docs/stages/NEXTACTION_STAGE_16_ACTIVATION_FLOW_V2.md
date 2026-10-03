
# NextAction Stage 16 — Activation Flow v2 Contract

**Status:** CONTRACT LOCKED — implementation merged; closure verification pending  
**Audit date:** 2026-09-28  
**Audit baseline master:** f9cb8442214e7c840076682c5ec10c2b9536924e  
**Current implementation master:** 3e0162777ca0709ca5b33c1b5adcefe2aca4cb0e  
**Repository:** fsoeltonione/nextaction

## 1. Purpose

Stage 16 closes the gap between the locked NextAction activation intent and the current live application flow.

This document is the implementation contract for Stage 16.

It does not change the core product domain:

~~~
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
~~~

It does not introduce payments, change qualification economics, or redesign the runtime.

The job of Stage 16 is to make activation deterministic, recoverable, server-authoritative, and faithful to the URL-first product experience.

## 2. Contract authority

1. Product Domain Truth remains authoritative for product semantics.
2. API Contract Truth remains authoritative for public runtime API semantics.
3. Supabase migrations in GitHub remain the schema source of truth.
4. This Stage 16 document is authoritative for activation-flow implementation details introduced here.
5. Existing Stage 8 behavior is historical reference where it conflicts with this Stage 16 contract.

No implementation branch may silently redefine any rule in this document.

## 3. Locked activation model

The earlier documentation used a single arrow sequence that was ambiguous about where authentication occurs. Stage 16 resolves that ambiguity explicitly.

### Canonical user flow

~~~
URL
  ↓
Product Understanding Proposal
  ↓
Conditional Auth
  ↓
Confirmed Product
  ↓
Intent
  ↓
Make Money / Reach Customers / Both
  ↓
Capability-Specific Setup
  ↓
Verification (when required)
  ↓
Truly Ready
  ↓
Dashboard
~~~

### Meaning of Conditional Auth

Authentication is not required to obtain the Product Understanding proposal.

Authentication becomes required at the persistence boundary:

- anonymous user → analyze first → authenticate before confirming/saving;
- authenticated user → analyze first → continue directly to confirmation.

So the intended experience is:

~~~
Anonymous:
URL → analyze → review → sign in → confirm → activate

Authenticated:
URL → analyze → review → confirm → activate
~~~

The authentication step is conditional on whether the browser already has an authenticated NextAction/Supabase session.

This is the locked interpretation of URL-first + conditional auth.

## 4. Stage 16 audit result

The audit was performed against:

- current master at f9cb8442214e7c840076682c5ec10c2b9536924e;
- current application source;
- current Stage 8 activation specification;
- current Product Domain Truth;
- current roadmap;
- live production Supabase schema/functions/policies;
- live staging Supabase schema/functions/policies;
- current Supabase security advisor.

### A1 — Product analysis currently occurs after authentication

**Severity:** BLOCKING

Current behavior is:

~~~
/ → /login?url=... → /onboarding?url=... → POST /api/analyze
~~~

This does not match the locked product experience, where Product Understanding is a proposal and may happen before authentication.

**Required Stage 16 behavior:**

~~~
/ → analyze proposal → review → authenticate only when persistence is required
~~~

The existing anonymous /api/analyze security boundary is retained: normalization, scanner controls, provider controls, bounded response handling, and rate limiting remain mandatory.

### A2 — Mutation state reloads are not applied to React state

**Severity:** BLOCKING

loadState() returns the server-derived activation state, but several mutation handlers call it while discarding the returned state.

Affected paths include:

- Product confirmation;
- capability selection;
- integration creation;
- integration verification;
- offer creation.

A successful server mutation therefore is not guaranteed to move the UI to the new server-derived step.

**Required Stage 16 behavior:**

After every successful mutation, the client must apply the returned server state before rendering the next step.

A bare await loadState() with the result discarded is not allowed.

### A3 — Workspace selection is currently implicit

**Severity:** BLOCKING for multi-workspace correctness

Current activation state and activation RPCs choose the first membership ordered by owner preference and creation time.

The live production database currently has no user belonging to multiple workspaces, so the failure is not exercised by current data. The schema nevertheless supports multiple workspaces.

**Required Stage 16 behavior:**

~~~
0 memberships  → first confirmation may create the initial workspace
1 membership   → automatic current workspace
2+ memberships → explicit workspace selection
~~~

The server must verify membership before using any selected workspace context.

A client-supplied workspace identifier is a selector, never proof of ownership.

No protected activation operation may silently fall back to first-membership ordering once multiple workspaces exist.

### A4 — Authenticated users cannot reliably use the landing page to start a new product activation

**Severity:** HIGH

The home page redirects an already-authenticated session to /dashboard before the URL entry can be used to start a new activation.

The dashboard currently provides Add Product, but that route begins at /onboarding without carrying the entered URL.

**Required Stage 16 behavior:**

Both must work:

~~~
Authenticated root + URL → Product analysis proposal
Dashboard → Add Product → URL entry with preserved pending URL
~~~

The root may still redirect an authenticated user to the dashboard when no activation URL is involved.

### A5 — OAuth failure can lose the pending URL

**Severity:** HIGH

The callback currently sends authentication failures to /login?error=auth_failed without preserving the pending URL.

**Required Stage 16 behavior:**

~~~
/login?url=<normalized-url>&error=auth_failed
~~~

No provider error body or credential data may be placed in the query.

### A6 — A newly typed onboarding URL can be lost on refresh

**Severity:** HIGH

When authenticated /onboarding has no url query parameter, the entered URL lives only in local React state.

The unconfirmed proposal must remain ephemeral, but the URL required to regenerate it must be recoverable.

**Required Stage 16 behavior:**

After URL submission:

- preserve the normalized URL in activation navigation state;
- preserve it through analysis;
- preserve it through OAuth;
- preserve it through auth failure;
- preserve it through refresh;
- allow analysis to be rerun.

### A7 — The current Add Moment fallback creates semantically meaningless keys

**Severity:** HIGH

The UI can create moment_1, moment_2, and similar placeholders.

Product Domain Truth requires stable, machine-readable, semantically meaningful Moment identifiers.

**Required Stage 16 behavior:**

A new Moment must have:

- human-readable label;
- valid lower snake_case key;
- semantically meaningful key;
- uniqueness within the Product.

The implementation must not knowingly promote generic placeholders such as moment_1 to canonical Product Moments.

### A8 — Reach Customers setup currently looks like final network targeting

**Severity:** CONTRACT CLARIFICATION

The product domain defines Reach Customers as advertising against relevant Moments in other products.

The current onboarding UI shows the user's own Product Moments when creating its first offer.

Stage 17 already owns final commercial UX and relational Moment targeting.

**Locked Stage 16 boundary:**

Reach Customers setup is activation readiness, not final network-targeting UX.

A first offer used during Stage 16 is a starter activation configuration.

It must not be presented as:

- complete network Moment inventory;
- proof of commercial deliverability;
- proof that cross-product targeting is fully implemented.

Final cross-workspace Moment discovery/targeting belongs to Stage 17.

### A9 — Live activation RPC implementation and GitHub migration text must be reconciled

**Severity:** BLOCKING SOURCE-OF-TRUTH ISSUE

The committed Stage 8 migration for create_offer_activation contains a workspace-scoped Moment validation condition.

The currently deployed production and staging function definitions do not contain that condition.

The live activation function and committed migration source therefore do not exactly match.

This audit does not silently decide which implementation behavior should win.

**Locked rule:**

Before Stage 16 code depending on offer-target behavior is accepted:

1. desired behavior follows Product Domain Truth;
2. live function and migration source are reconciled;
3. reconciliation is captured as a new GitHub migration;
4. no manual, untracked SQL edit is an acceptable permanent fix.

Because final cross-workspace targeting belongs to Stage 17, Stage 16 must not expand commercial scope merely to resolve this.

### A10 — Capability removal semantics differ between Stage 8 documentation and live write behavior

**Severity:** MEDIUM

Stage 8 documentation describes unselected capabilities as becoming disabled.

The current set_workspace_capabilities function deletes unselected capability rows.

For activation-state derivation, only active selected capabilities are currently authoritative.

**Locked Stage 16 interpretation:**

- active selected capabilities are authoritative;
- absence means not selected;
- readiness does not depend on historical capability rows;
- retaining disabled history is not a Stage 16 requirement.

### A11 — Product Understanding is correctly proposal-oriented

**Severity:** PASS

The analysis result is a proposal. The confirmation endpoint is the persistence boundary.

Stage 16 preserves:

~~~
Analyze ≠ Persist
~~~

The user can edit Product and Moment definitions before confirmation.

### A12 — Server-side confirmation is transactionally bounded

**Severity:** PASS with preservation requirement

confirm_product_activation is the atomic Product/Moment persistence boundary.

Stage 16 preserves server normalization, validation, atomic persistence, disablement of removed existing Moments, and Moment-key uniqueness.

### A13 — Anonymous analysis already has a security boundary

**Severity:** PASS with preservation requirement

/api/analyze is public, but it already uses:

- URL normalization;
- Product Scanner;
- DNS/IP safety checks;
- redirect validation;
- timeout/response limits;
- provider controls;
- structured output validation;
- per-IP analysis rate limiting.

Moving analysis before auth must not weaken these controls.

### A14 — Redirect safety exists and must remain the callback boundary

**Severity:** PASS**

The OAuth callback uses safeInternalRedirect and permits only approved internal paths.

Stage 16 may change pending-URL preservation but must not turn the auth next parameter into an external redirect primitive.

## 5. Locked state machine

Activation state remains server-derived.

Canonical states:

~~~
url
product_understanding
intent
capability_setup
verification
ready
~~~

The browser must never be able to declare itself ready.

### url

Use when the current activation workspace has no confirmed Product for the activation context.

### product_understanding

Use for an unconfirmed Product or a new pending URL with an unconfirmed Product Understanding proposal.

### intent

Use when Product is confirmed but no active capability exists.

### capability_setup

Use when a selected capability lacks its Stage 16 activation prerequisite.

### verification

Use when Make Money setup exists but its activation credential has not completed the required verification.

### ready

Use only when every selected capability has satisfied its Stage 16 prerequisite.

## 6. Current workspace contract

Stage 16 introduces the concept of a current activation workspace.

### Resolution

~~~
0 memberships  → no workspace; first confirmation may create one
1 membership   → automatic current workspace
2+ memberships → explicit workspace selection
~~~

The server verifies membership on every protected request.

The client may request a workspace context, but that context is never treated as authorization evidence.

The following operations must resolve against the same current workspace:

- GET /api/onboarding/state
- POST /api/products/confirm
- POST /api/workspaces/capabilities
- POST /api/integrations/create
- POST /api/integrations/verify
- POST /api/offers/create

No operation may independently choose the first workspace.

## 7. URL and pending activation context

Every URL from home input, query parameters, OAuth next values, or onboarding navigation is untrusted.

The server must normalize/validate again before protected persistence.

Before Product confirmation:

- no Product is created;
- no canonical Moment is created;
- no capability is persisted;
- no integration is created;
- no offer is created.

The unconfirmed proposal is ephemeral.

After URL submission, the normalized URL must remain recoverable through navigation/auth state.

## 8. Product Understanding contract

The logical endpoint remains:

~~~
POST /api/analyze
~~~

It may be called anonymously.

Its response is a proposal, not persisted Product truth.

The review UI must support:

- Product name edit;
- Product description edit;
- Moment label edit;
- Moment key edit;
- Moment description edit;
- Moment add;
- Moment remove.

### Moment key rules

A canonical Moment key:

- is lower snake_case;
- is unique within the Product;
- is machine-readable;
- is semantically meaningful;
- remains stable after confirmation unless deliberately migrated.

Examples:

~~~
invoice_created
subscription_cancelled
team_invited
report_generated
~~~

Generic placeholders are not acceptable final keys:

~~~
moment_1
moment_2
new
temp
thing
foo
~~~

## 9. Conditional authentication contract

### Anonymous path

~~~
URL
→ analysis proposal
→ review
→ auth
→ confirmation
~~~

### Authenticated path

~~~
URL
→ analysis proposal
→ review
→ confirmation
~~~

### Generic login

When there is no pending activation URL, successful authentication returns to:

~~~
/dashboard
~~~

### Auth error

If activation context exists, authentication failure preserves the pending URL and returns to the login surface with a safe error indicator.

## 10. Product confirmation contract

The persistence endpoint remains:

~~~
POST /api/products/confirm
~~~

It is authenticated-only.

The server remains authoritative for:

- workspace context;
- canonical URL;
- Product ownership;
- Moment definitions.

Confirmation remains atomic.

If multi-workspace selection is introduced, the selected workspace is merely a candidate context and must be server-validated against membership before use.

## 11. Intent contract

The user-facing choices are exactly:

~~~
Make Money
Reach Customers
Both
~~~

Persisted capabilities remain:

~~~
make_money
reach_customers
~~~

Both means both persisted capabilities are active. No third stored capability named both is introduced.

## 12. Capability-specific setup contract

### Make Money

Activation requires:

1. active make_money capability;
2. Product integration exists;
3. an na_live_ credential has been issued;
4. only its hash is persisted;
5. plaintext is displayed only at issuance;
6. verification confirms the token resolves to the authorized Product integration.

Activation verification does not prove production /v1/track traffic or runtime end-to-end behavior.

### Reach Customers

Stage 16 may use a starter offer configuration as the activation prerequisite.

It must be described as activation setup, not final network campaign management.

MVP payment-provider integration is not required.

## 13. Verification contract

Verification is conditional.

Make Money requires verification because its activation prerequisite includes a credential association check.

Reach Customers does not require a fake verification step solely because that capability was selected.

Both requires all selected capability prerequisites.

## 14. Ready-state contract

Ready is derived, not user-selected.

The UI may show the activation-complete screen only after server-derived state reports:

~~~
step = ready
~~~

The ready screen displays only server-derived state and then offers dashboard handoff.

## 15. Mutation/state synchronization contract

Every mutation follows:

~~~
User action
→ protected API mutation
→ authoritative server write
→ authoritative state reload/application
→ render next step
~~~

A discarded state reload result is prohibited.

A regression test must prove the full transition chain and the same state after browser refresh.

## 16. Failure and recovery contract

### Analysis failure

Stay on URL/proposal entry, preserve the URL, show a retryable error, and create no partial Product state.

### Confirmation failure

Stay on Product Understanding and keep the editable proposal visible.

### Capability write failure

Stay on Intent. Do not report the capability as saved until the server confirms.

### Capability setup failure

Stay on Capability Setup. No false success.

### Verification failure

Stay on Verification. Keep the integration unverified.

### Session expiration

Protected operations return an authentication failure and preserve pending activation context.

## 17. Browser navigation contract

### Refresh

After confirmation, server state must fully restore the activation step.

Before confirmation, the pending URL must be recoverable and analysis may be rerun.

### Back

Returning to URL entry must not silently delete confirmed server state.

### Deep link

/onboarding?url=<normalized-url> is valid activation entry.

An unauthenticated deep link must route through auth while preserving the URL.

### Root

/ is the primary acquisition entry.

An authenticated user submitting a URL from the root must be allowed to start a new Product Understanding proposal.

## 18. Security contract

Stage 16 preserves all trust boundaries.

Never trust the browser for:

- workspace ownership;
- Product ownership;
- capability authorization;
- integration ownership;
- verification state;
- financial values.

Service-role secrets remain server-only.

Pending URLs are untrusted input and are revalidated before persistence.

OAuth redirects remain internal-only.

## 19. Data invariants

Stage 16 preserves:

1. Product identity is normalized canonical URL within its workspace.
2. Product confirmation is atomic.
3. Removed existing Moments are disabled rather than hard-deleted during confirmation.
4. Moment keys are unique within a Product.
5. Capabilities are workspace-level.
6. Integration credentials are hashed at rest.
7. Plaintext credentials are not stored in browser persistence.
8. Offer targeting remains relational through offer_moments.
9. Financial tables remain inaccessible to browser clients.
10. No Stage 16 UI becomes a financial authority.

## 20. Test contract

Stage 16 must add green coverage for:

### Anonymous

~~~
URL → analyze → proposal → login → callback → proposal preserved → confirm
~~~

### Authenticated

~~~
authenticated → URL → analyze → proposal → confirm
~~~

### Multi-workspace

- zero workspace;
- one workspace;
- multiple workspaces;
- no silent first-workspace fallback;
- unauthorized workspace context rejected.

### Recovery

- refresh after URL submission;
- refresh after analysis;
- refresh after confirmation;
- refresh after intent;
- refresh after capability setup;
- refresh after verification.

### Mutation synchronization

Every successful mutation updates the UI from server state.

### Auth error

Pending URL survives failed authentication.

### Moment editing

- add;
- edit;
- remove;
- invalid key;
- duplicate key;
- generic placeholder key rejected.

### Capabilities

~~~
Make Money
Reach Customers
Both
~~~

Each follows the correct derived state.

### Ready

Ready is reproducible after a full refresh.

## 21. Acceptance matrix

| Scenario | Expected result |
|---|---|
| Anonymous enters valid SaaS URL | Analysis proposal appears without login |
| Anonymous analysis succeeds | Editable Product/Moment proposal appears |
| Anonymous proceeds to save | Login required at persistence boundary |
| OAuth succeeds | Pending URL/proposal context survives |
| OAuth fails | Login retains pending URL and safe error |
| Authenticated user enters SaaS URL | No redundant login wall |
| User refreshes before confirmation | URL survives; proposal can be regenerated |
| User confirms Product | Product + Moments persist atomically |
| Product removes a Moment | Existing Moment is disabled, not hard-deleted |
| Product adds a Moment | New meaningful key is required |
| User selects Make Money | Integration setup becomes required |
| Make Money verified | Activation can proceed when other prerequisites are complete |
| User selects Reach Customers | Starter setup follows Stage 16 boundary, not final network targeting |
| User selects Both | Both capability prerequisites are required |
| User refreshes after setup | Server restores the same state |
| User has multiple workspaces | Explicit workspace context is required |
| Unauthorized workspace context | Request rejected |
| Generic login with no pending URL | Successful auth returns to dashboard |
| Ready state | Dashboard handoff available |
| Client mutates local step state | Server-derived state remains authoritative |

## 22. Explicit non-goals

Stage 16 does not implement:

- Event → Moment runtime changes;
- Decision/Delivery changes;
- Click/Qualified Click changes;
- Settlement changes;
- automated payments;
- automated publisher payouts;
- advanced fraud scoring;
- identity graph;
- cross-site user tracking;
- final cross-workspace Moment marketplace/search;
- final advertiser campaign-management UX;
- advanced targeting/frequency controls;
- widget/HTML delivery;
- microservice decomposition.

## 23. Implementation order

1. Activation context, pending URL, and current workspace.
2. Public proposal path and authenticated proposal path.
3. Product/Moment review.
4. Persistence synchronization.
5. Capability activation.
6. Verification and ready.
7. Failure/recovery and navigation.
8. Functional, authorization, multi-workspace, and end-to-end tests.

## 24. Exit criteria

Stage 16 is complete only when:

1. Actual user flow matches this contract.
2. Anonymous Product analysis can happen before authentication.
3. Authentication is conditional on persistence.
4. Pending URL survives auth and recovery paths.
5. Product/Moment confirmation remains atomic and server-authoritative.
6. Multiple workspaces never fall back silently to the first membership.
7. Successful mutations always render server-derived state.
8. Generic Moment placeholders cannot become canonical keys.
9. Make Money and Reach Customers remain distinct capabilities.
10. Ready is server-derived and refresh-safe.
11. Failure paths are recoverable.
12. All Stage 16 tests are green.
13. Any live-vs-migration activation RPC drift is reconciled through GitHub migrations.
14. Stage 16 does not silently introduce Stage 17 commercial targeting semantics.

## 25. Change-control rule

Any change to:

- activation sequence;
- authentication boundary;
- workspace resolution;
- Product confirmation semantics;
- Moment identity;
- capability semantics;
- readiness criteria;

requires an explicit amendment to this document and the corresponding authoritative product/API documentation.

Implementation convenience is not a valid reason to change the contract.

## Final locked Stage 16 model

~~~
URL
→ Product Understanding Proposal
→ Conditional Auth
→ Confirmed Product
→ Intent
→ Make Money / Reach Customers / Both
→ Capability-Specific Setup
→ Verification (when required)
→ Truly Ready
→ Dashboard
~~~

Non-negotiable principles:

~~~
Analyze ≠ Persist
Client state ≠ Authority
Workspace selector ≠ Authorization
Ready = server-derived
Moment key = semantic + stable
Financial truth = server-only
~~~

Stage 16 implementation must follow this contract exactly.
