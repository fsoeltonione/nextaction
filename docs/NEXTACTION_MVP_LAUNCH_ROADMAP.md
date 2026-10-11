# NextAction — Roadmap Audit & Official MVP-to-Launch Roadmap

**Status:** Roadmap with current 2026-10-12 product decision applied  
**Audit date:** 2026-10-11  
**Repository:** `fsoeltonione/nextaction`  
**Roadmap baseline master:** `f9cb8442214e7c840076682c5ec10c2b9536924e`  
**Completed through:** Stage 15  
**Current milestone:** Stage 16 — Activation Flow v2 completion (URL-first UI and authenticated activation are implemented; automated anonymous proposal proof is being added)

---

## 1. Purpose

This document converts the repository's existing product truth, architecture truth, data/security truth, stage documents, MVP plan, and current implementation state into one ordered roadmap from the end of Stage 14 to public MVP launch.

It is intended to prevent two recurring problems:

1. treating an old stage document as if it described current implementation state;
2. starting a later feature before the security, data, UX, runtime, and operational prerequisites are actually closed.

Current product decision (2026-10-12): drop product AI analysis and website crawling from the MVP. The publisher URL is a reference only. Publishers manually enter product metadata and Moments. The prior Stage 15 scanner is superseded and must not be treated as a current MVP dependency.

This roadmap does **not** change the locked product domain.

The canonical chain remains:

```
Event
  →
Moment
  →
Decision
  →
Delivery
  →
Click
  →
Qualified Click
  →
Settlement
```

Workspace capabilities remain:

```
Make Money
Reach Customers
Both
```

MVP economics remain:

```
1 Qualified Click = $1.00 advertiser charge
$0.75 publisher
$0.25 NextAction
```

---

## 2. Roadmap audit result

### Completed and operational

Stage 6 established the production data foundation and tenant/security boundaries.

Stage 7 established reusable application and security primitives.

Stage 8 established server-authoritative control-plane primitives and the intended activation state model.

Stage 9 established the executable Event → Moment → Decision → Delivery runtime, queue/worker, and rate limiting.

Stage 10 established Click recording, token validation, replay-safe redirects, and click rate limiting.

Stage 11 defined the qualification policy gate.

Stage 12 implemented Qualification Policy v1.

Stage 13 implemented atomic, idempotent settlement and financial ledger mutation.

Stage 14 proved the real staging → production release path, including:

```
Event
→ Moment
→ Decision
→ Delivery
→ Click
→ Qualified Click
→ Settlement
→ replay/idempotency
→ production promotion
```

Stage 14 is therefore **closed**.

### Important gaps still visible in the current implementation

The repository documents and current application source expose several remaining gaps that must shape the roadmap.

#### A. Product analysis/crawling removed from MVP

The former Stage 15 scanner and `POST /api/analyze` have been removed from the current MVP branch by product decision. There is no product-page retrieval, crawler, or LLM provider requirement in onboarding or release gates. The submitted URL is normalized and stored as publisher-provided reference data only.

#### B. Stage 16 activation uses manual Product/Moment setup

The homepage sends the normalized URL to `/onboarding?url=...`, without a login wall. The onboarding page creates an editable blank draft and asks the publisher to enter the product name, description, and semantic Moments manually. No AI/crawler request is made.

Saving remains an authenticated persistence boundary:
- `GET /api/onboarding/state` remains private and returns HTTP 401 to anonymous users;
- `POST /api/products/confirm` returns HTTP 401 until a user authenticates;
- the browser preserves the normalized URL and manual form draft through login/refresh/retry;
- confirmed Products/Moments, workspace selection, capabilities, integration verification, and offer setup remain covered by activation acceptance;
- anonymous staging acceptance verifies the blank manual form and persistence denial, not auto-derived 3–8 Moments.

#### C. Some dashboard behavior is still prototype-shaped

The current dashboard contains the expected Monetize / Advertise surfaces and renders integration snippets / offer controls, but the advertiser balance display currently contains a hard-coded `$25.00` presentation.

That is not sufficient for a real commercial control plane.

Stage 17 must replace prototype presentation with authoritative workspace/account state.

#### D. Commercial operations are intentionally incomplete

The product truth explicitly defers payment-provider integration for MVP.

Manual/mock advertiser capacity is allowed.

Therefore launch does not require an automated payment gateway, but it does require an explicit operating procedure for:

- advertiser capacity provisioning;
- ledger/reconciliation;
- publisher earnings handling;
- refunds/reversals or dispute treatment, if applicable;
- account support and abuse handling.

These operational rules must be documented before public launch.

#### E. Architecture contains deliberate non-decisions

The architecture document intentionally leaves several items open, including:

- exact payment gateway;
- automatic publisher payouts;
- advanced targeting/frequency controls;
- widget/HTML delivery;
- exact rate-limit vendor;
- exact observability vendor.

The roadmap does not silently turn those into launch requirements unless explicitly stated below.

---

## 3. Official remaining milestone count

There are **7 remaining milestones** after the completion of Stage 15, leading to the defined public MVP launch:

| Stage | Milestone | Primary outcome |
|---|---|---|
| **15 (historical)** | Former DNS-aware Product Scanner / SSRF Hardening | **SUPERSEDED / REMOVED FROM MVP** — no crawler/analyzer dependency |
| **16** | Activation Flow v2 Completion | Fully URL-first, conditional-auth activation |
| **17** | Control Plane & Commercial UX Completion | Real publisher/advertiser operating surfaces |
| **18** | Runtime Reliability, Observability & Performance | Production-grade runtime behavior under load/failure |
| **19** | Commercial Operations & Abuse Controls | Human-operable money/abuse/support loop |
| **20** | Final Launch Readiness / Gate F | Security, data, migration, release, and operational sign-off |
| **21** | Controlled Private Beta | Real external users under constrained exposure |
| **22** | Public MVP Launch | Publicly usable MVP |

So the roadmap is:

```
Stage 14 ✅
   ↓
Stage 15 scanner — historical only; removed from MVP
   ↓
16 Activation v2
   ↓
17 Control Plane / Commercial UX
   ↓
18 Reliability / Observability / Performance
   ↓
19 Commercial Ops / Abuse
   ↓
20 Launch Readiness Gate F
   ↓
21 Private Beta
   ↓
22 Public MVP Launch
```

---

# 4. Former Stage 15 scanner — superseded by product decision

Stage 15 previously implemented product URL crawling and SSRF/DNS-rebinding hardening. On 2026-10-12, the MVP direction changed: the scanner, analyzer, model-provider configuration, and scanner-specific release checks are removed from the MVP. This historical stage remains documented for audit, but it is no longer an active launch milestone. The submitted URL is reference data only, and onboarding does not fetch it.

---

# 5. Stage 16 — Activation Flow v2 Completion

## Objective

Make the live user experience match the locked activation contract:

~~~
URL Reference
→ Manual Product Setup
→ Conditional Auth
→ Confirmed Product
→ Intent
→ Make Money / Reach Customers / Both
→ Capability-Specific Setup
→ Verification (when required)
→ Truly Ready
→ Dashboard
~~~

The flow is explicitly two-phase:

- Draft phase: normalize the URL locally and collect publisher-entered product name, description, and Moments without requiring authentication or fetching the site.
- Persistence/activation phase: conditional authentication → Product confirmation → intent → capability setup → verification → ready.

## Locked scope

### URL-first proposal
- anonymous form drafting remains permitted; no server-side Product analysis endpoint exists;
- authenticated users may analyze a new URL without being redirected away first;
- pending normalized URL survives login, auth failure, refresh, and retry;
- manual drafting never persists Product truth until the authenticated confirmation boundary.

### Conditional authentication
- anonymous users authenticate only at the persistence boundary;
- authenticated users do not see a redundant login wall;
- generic login without activation context returns to dashboard;
- OAuth callback remains limited to approved internal paths;
- authentication failure preserves pending activation context.

### Manual Product Setup
- Product name/description editable;
- Moment label/key/description editable;
- Moment add/remove supported;
- canonical Moment keys must be stable, machine-readable, and semantically meaningful;
- generic placeholders such as moment_1 cannot become confirmed Product Moments.

### Workspace context
- zero memberships → first confirmation may create the initial workspace atomically;
- one membership → automatic current workspace;
- multiple memberships → explicit workspace selection;
- every protected activation operation uses the same server-validated current workspace;
- no silent first-membership fallback.

### Server-derived activation state
States remain url, product_understanding, intent, capability_setup, verification, ready.

Every successful mutation must apply/reload authoritative server state. A discarded state reload is not allowed.

### Capability activation
The UI has exactly Make Money, Reach Customers, Both.

Make Money requires integration issuance/verification.

Reach Customers may use a starter activation offer, but Stage 16 must not silently define final cross-workspace commercial targeting. Final network targeting belongs to Stage 17.

### Failure/recovery
Confirmation failure, capability failure, setup failure, verification failure, session expiry, refresh, deep links, and browser navigation must remain recoverable. There is no analysis/crawler failure path in the MVP.

## Contract blockers from the Stage 16 audit

1. pre-auth manual draft sequencing;
2. mutation-to-server-state synchronization;
3. current workspace context for multi-workspace users;
4. authenticated URL-first entry;
5. OAuth pending-URL preservation on failure;
6. pending URL recovery on refresh;
7. semantic Moment-key creation;
8. live-vs-migration activation RPC reconciliation.

## Exit criteria

A new user can submit a SaaS URL as a reference, enter Product/Moment details before login, authenticate only when saving is required, confirm Product and Moments, select capabilities, complete selected activation setup, reach a server-derived ready state, refresh safely, and open the dashboard.

All Stage 16 contract tests must be green.

# 6. Stage 17 — Control Plane & Commercial UX Completion

## Objective

Turn the current prototype-shaped dashboard and setup surfaces into real control-plane behavior backed by authoritative data.

## Publisher side

- real integration credential lifecycle;
- secure credential display-once behavior;
- integration verification;
- revocation/rotation controls;
- usable integration instructions/snippet;
- Moment inventory;
- runtime readiness state;
- earnings view sourced from financial state;
- clear zero/no-data states.

## Advertiser side

- offer creation/edit/pause/archive;
- relational Moment targeting;
- live remaining capacity;
- offer status;
- delivery/click/qualified-click counters;
- clear no-capacity behavior;
- manual capacity administration path;
- destination validation feedback.

## Dashboard truth rule

The UI must not invent:

- balance;
- capacity;
- spend;
- publisher earnings;
- settlement state.

All commercial numbers must come from server-authoritative data.

## Exit criteria

Publisher and advertiser workflows work end-to-end against live staging data without hard-coded commercial values or prototype-only persistence paths.

---

# 7. Stage 18 — Runtime Reliability, Observability & Performance

## Objective

Move from “works end-to-end” to “behaves predictably under realistic production conditions.”

## Scope

### Runtime reliability

- Event acceptance under concurrent replay;
- queue retry behavior;
- poison-message handling;
- worker failure/recovery;
- duplicate delivery protection;
- click replay;
- qualification replay;
- settlement contention;
- exhausted capacity behavior;
- timeout/fail-open boundaries for `/v1/offer`.

### Observability

Trace:

```
request
→ Event
→ Moment
→ Decision
→ Delivery
→ Click
→ Qualified Click
→ Settlement
```

Required correlation fields include the identifiers already specified by architecture/data truth.

### Performance

Benchmark:

- `/v1/track` acceptance latency;
- `/v1/offer` latency;
- queue delay;
- worker processing time;
- click latency;
- settlement contention.

The MVP architecture document explicitly treats the old “<100 ms” figure as a benchmark target rather than an assumed fact.

## Exit criteria

Production-like concurrency and failure tests demonstrate that the runtime remains idempotent, fail-safe, observable, and within the agreed SLOs.

---

# 8. Stage 19 — Commercial Operations & Abuse Controls

## Objective

Make NextAction operationally usable by humans, not only technically executable.

## Scope

### Commercial operations

- manual advertiser capacity provisioning;
- capacity adjustment audit trail;
- settlement/reconciliation procedure;
- publisher earnings reconciliation;
- support workflow for disputed/missing outcomes;
- account suspension procedure;
- operational reporting.

### Abuse


- runtime request abuse controls;
- click abuse controls;
- credential abuse/revocation;
- suspicious traffic handling;
- rate-limit tuning based on observed workload.

### Privacy

The system remains a contextual network rather than an identity graph.

Any new identity/fraud signal must have an explicit product/privacy decision.

## Exit criteria

A real operator can answer:

- who has capacity;
- what capacity remains;
- what was consumed;
- what was earned;
- what was settled;
- what needs investigation;
- which account/credential can be disabled;

without editing the production database manually outside the defined operating procedure.

---

# 9. Stage 20 — Final Launch Readiness / Gate F

## Objective

Provide a formal pre-launch gate across code, database, security, infrastructure, commercial operations, and documentation.

## Required gates

### Product

- locked domain chain unchanged;
- activation flow matches product truth;
- capability semantics unchanged.

### Security


- SSRF/redirect controls green;
- secret boundaries verified;
- runtime privileges verified;
- RLS and grants verified;
- accepted Supabase Free-plan password-protection exception explicitly re-acknowledged;
- no password-auth feature introduced without revisiting that exception.

### Data

- migration history reproducible;
- staging and production isolated;
- settlement invariants verified;
- duplicate settlement impossible;
- immutable ledger guarantees verified.

### Runtime

- end-to-end smoke green;
- idempotency/replay green;
- rate limits green;
- queue worker healthy;
- health endpoint green.

### CI/CD

- quality;
- typecheck;
- build;
- Cloudflare compatibility;
- Cloudflare build;
- staging deployment;
- staging smoke;
- production approval;
- production smoke.

### Operational

- support contact;
- incident procedure;
- rollback procedure;

- commercial reconciliation procedure;
- launch monitoring dashboard.

## Exit criteria

No unresolved **launch-blocking** issue remains.

Accepted, documented MVP exceptions may remain only when they are explicitly recorded and do not invalidate the core product/security/economic contract.

---

# 10. Stage 21 — Controlled Private Beta

## Objective

Expose the real system to a deliberately constrained external cohort before public availability.

## Constraints

- limited number of publisher/advertiser workspaces;
- manually provisioned advertiser capacity;
- monitored runtime;
- manual support;
- aggressive incident observation;
- no assumption that staging smoke equals user-scale proof.

## Measure

- onboarding completion;
- product-understanding correction rate;
- Moment correction rate;
- integration activation rate;
- offer creation rate;
- fill/no-fill;
- click rate;
- qualification rate;
- settlement success/replay rate;

- runtime latency;
- abuse incidents.

## Exit criteria

The beta demonstrates that the complete commercial loop works with real external users and that recurring operational failures are understood and controlled.

---

# 11. Stage 22 — Public MVP Launch

## Launch definition

NextAction is considered publicly launched when an external user can:

1. submit a SaaS URL;
2. complete secure product understanding/activation;
3. choose Make Money, Reach Customers, or Both;
4. complete the required setup;
5. operate through the dashboard;
6. use the publisher runtime;
7. create/deliver offers;
8. produce qualified clicks;
9. produce correct settlement outcomes;
10. inspect the resulting operational state.

The MVP may use **manual advertiser funding/capacity** because payment-provider integration is explicitly deferred by the product truth.

Automated payments/payouts are therefore **not launch-blocking unless the product decision is changed**.

Public launch does require a documented manual commercial operating procedure.

## Exit criteria

- Gate F passed;
- Private Beta exit criteria passed;
- production monitoring active;
- rollback tested;
- support path active;
- launch documentation published;
- production data boundaries verified;
- no known critical security or financial-integrity defect.

---

# 12. What is deliberately NOT required before MVP launch

The following remain outside the launch-critical path unless a new product decision explicitly promotes them:

- identity graph;
- cross-site user tracking;
- device fingerprinting;
- advanced fraud scoring;
- advanced targeting/frequency systems;
- HTML/widget delivery as a core dependency;
- automated payment gateway;
- automated publisher payouts;
- microservices decomposition.

This keeps the launch path consistent with the existing product and architecture decisions.

---

# 13. Cross-stage invariants

Every stage from 15 onward must preserve:

1. Moment remains the core semantic primitive.
2. Event, Moment, Decision, Delivery, Click, Qualified Click, and Settlement remain distinct.
3. Qualification and settlement remain server-authoritative.
4. Settlement remains atomic and idempotent.
5. Runtime traffic does not depend on end-user Supabase Auth.
6. Product URL input remains untrusted.
7. Publisher-hosted UX remains fail-open where specified.
8. GitHub migrations remain the database source of truth.
9. Cloudflare remains the application deployment target.
10. Accepted security exceptions remain explicit and do not silently become “fixed.”

---

# 14. Milestone governance rule

A future Stage document must be created or updated **before implementation starts** when that stage introduces a new product/security/data decision.

Implementation branches must not silently redefine a later stage.

Recommended working sequence:

```
Roadmap
→ Stage specification
→ implementation branch
→ tests
→ CI
→ staging
→ production gate
→ merge
→ next stage
```

---

## 15. Final roadmap answer

**Remaining after Stage 15: 7 milestones.**

```
15  Former URL Scanner / SSRF hardening — SUPERSEDED / REMOVED FROM MVP
16  Activation Flow v2 Completion
17  Control Plane & Commercial UX Completion
18  Runtime Reliability / Observability / Performance
19  Commercial Operations & Abuse Controls
20  Final Launch Readiness / Gate F
21  Controlled Private Beta
22  Public MVP Launch
```

Stage 15 is now closed. The next implementation target is **Stage 16 — Activation Flow v2 Completion**.
