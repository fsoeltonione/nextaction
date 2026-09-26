# NextAction — Roadmap Audit & Official MVP-to-Launch Roadmap

**Status:** Proposed official roadmap for post-Stage-14 work  
**Audit date:** 2026-09-27  
**Repository:** `fsoeltonione/nextaction`  
**Current master:** `0005358464b12eaffda6bc4c9d32e6a1e78a6829`  
**Completed through:** Stage 14  
**Next milestone:** Stage 15 — DNS-aware Product Scanner / SSRF Hardening

---

## 1. Purpose

This document converts the repository's existing product truth, architecture truth, data/security truth, stage documents, MVP plan, and current implementation state into one ordered roadmap from the end of Stage 14 to public MVP launch.

It is intended to prevent two recurring problems:

1. treating an old stage document as if it described current implementation state;
2. starting a later feature before the security, data, UX, runtime, and operational prerequisites are actually closed.

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

#### A. Product analysis is not yet a complete server-side scanner

`src/lib/url.ts` performs URL normalization and rejects obvious blocked host forms.

`src/lib/external-url.ts` validates HTTP(S) destination syntax and rejects embedded credentials / obvious blocked hosts.

`src/app/api/analyze/route.ts` currently sends the normalized URL to the model provider and applies provider timeout/response/output validation. It does **not** yet perform arbitrary remote page retrieval itself.

Therefore Stage 15 is a required **future trust-boundary milestone** before controlled server-side retrieval is introduced. The absence of current arbitrary page fetching must not be mistaken for completion of the scanner requirement.

The authoritative data/security and architecture documents explicitly require:

- normalization;
- SSRF resistance;
- DNS/IP safety checks;
- redirect validation;
- timeouts;
- response-size limits;
- content-type checks;
- abuse/rate controls;
- bounded LLM input;
- structured output validation.

#### B. The desired URL-first activation sequence is not fully aligned with the live UI

The locked product flow is:

```
URL
→ conditional auth
→ product understanding
→ intent
→ Make Money / Reach Customers / Both
→ capability-specific setup
→ verification
→ truly ready
→ dashboard
```

The current homepage still routes the submitted URL to `/login?url=...`, while the onboarding page performs analysis after authentication.

That means the repository contains the correct **state model and supporting APIs**, but the complete user-facing sequence is not yet identical to the locked product flow.

Stage 16 closes this mismatch.

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

There are **8 remaining milestones** from the end of Stage 14 to the defined public MVP launch:

| Stage | Milestone | Primary outcome |
|---|---|---|
| **15** | DNS-aware Product Scanner / SSRF Hardening | Safe server-side product retrieval boundary |
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
15 Scanner / SSRF
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

# 4. Stage 15 — DNS-aware Product Scanner / SSRF Hardening

## Objective

Turn product URL analysis into a controlled, server-side internet retrieval boundary without introducing SSRF, redirect, DNS-rebinding, resource-exhaustion, or unsafe-content failures.

## Scope

- canonical URL normalization;
- DNS A/AAAA resolution before retrieval;
- blocking loopback, private, link-local, multicast, reserved, and other disallowed address ranges;
- IPv4 and IPv6 coverage;
- redirect handling with a hard limit;
- re-validation of every redirect target;
- request timeout;
- response body byte limit;
- content-type allowlist;
- bounded parsing;
- compression/decompression safeguards;
- request/rate/abuse controls;
- safe User-Agent policy;
- no credential forwarding;
- no cookies or authorization headers forwarded to arbitrary targets;
- structured scanner result;
- explicit error classification;
- scanner unit/integration security corpus;
- DNS-rebinding/TOCTOU threat-model decision;
- deployment-specific implementation for Cloudflare Workers.

## Important implementation constraint

Cloudflare Workers currently expose `node:dns` resolution through DNS-over-HTTPS, and DNS requests count as Worker subrequests. Workers documentation also states that direct fetches to IP-address URLs are not supported. Therefore the scanner design must not claim “DNS pinning” merely because it performs a preliminary DNS lookup. A real TOCTOU-safe design must be proven against the actual Worker egress behavior.

The Stage 15 design gate must explicitly decide whether the implementation can provide true connection pinning on the selected platform or whether arbitrary remote retrieval must go through an isolated egress mechanism.

Worker redirects must also be handled deliberately: Cloudflare documents that `fetch()` with redirect-following can forward headers to a different host, so the scanner should use manual redirect handling rather than blindly following redirects.

## Exit criteria

Stage 15 is complete only when:

- the scanner has a documented threat model;
- DNS/IP validation covers IPv4 and IPv6;
- redirect targets are revalidated;
- resource limits are enforced;
- disallowed destinations are tested;
- hostile fixtures are tested;
- no secret/cookie/header leakage is possible;
- scanner output is schema-validated;
- abuse controls are active;
- the chosen Cloudflare-safe egress strategy is documented and tested;
- all scanner tests are green in CI.

---

# 5. Stage 16 — Activation Flow v2 Completion

## Objective

Make the live user experience match the locked activation contract exactly.

## Target flow

```
URL
→ product understanding
→ conditional auth
→ confirmed product
→ intent
→ Make Money / Reach Customers / Both
→ capability setup
→ verification
→ truly ready
→ dashboard
```

## Scope

- anonymous/pre-auth URL state;
- server-safe preservation of pending URL;
- product analysis before authentication where allowed by the security model;
- product understanding proposal;
- Moment discovery and review;
- add/remove/edit Moment;
- canonical URL confirmation;
- conditional Google auth at the persistence boundary;
- atomic product confirmation;
- capability persistence;
- Make Money activation;
- Reach Customers activation;
- verification state;
- recovery from failed analysis;
- retry/restart behavior;
- deep-link handling;
- activation-state rehydration from server truth;
- removal of client-only authority;
- explicit ready state;
- dashboard handoff.

## Exit criteria

A new user can start from a SaaS URL and reach a server-derived ready state without seeing infrastructure concepts, and every transition is recoverable from server state.

---

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

- scanner abuse controls;
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

- scanner security suite green;
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
- scanner abuse response;
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
- scanner rejection/error rate;
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

**Remaining: 8 milestones.**

```
15  DNS-aware Product Scanner / SSRF Hardening
16  Activation Flow v2 Completion
17  Control Plane & Commercial UX Completion
18  Runtime Reliability / Observability / Performance
19  Commercial Operations & Abuse Controls
20  Final Launch Readiness / Gate F
21  Controlled Private Beta
22  Public MVP Launch
```

The next implementation target is therefore **Stage 15**, but Stage 15 itself begins with a short security/architecture audit of the current analyzer and Cloudflare egress constraints—not with immediately adding a fetch call.
