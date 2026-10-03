# NextAction Architecture Truth

**Status:** Authoritative v1  
**Depends on:** `docs/NEXTACTION_PRODUCT_DOMAIN_TRUTH.md`  
**Baseline:** Git SHA `f761a32e24927bc21456306ca539ced00bdcf4d3`  
**Created:** 2026-09-26

## 1. Architecture objective

NextAction should be implemented as a secure, low-latency, event-driven contextual promotion platform without prematurely splitting the system into microservices.

The architecture must preserve the locked domain chain:

**Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement**

The current UI prototype is not the architectural foundation. The production foundation is a modular domain/application/infrastructure design with explicit trust boundaries.

## 2. Primary architecture decision

### ADR-001: Modular monolith first

Use one repository and one coherent domain model, with strict internal module boundaries, rather than microservices.

The system is divided into:
1. Experience / Control Plane
2. Runtime / Data Plane
3. Domain Core
4. Persistence
5. Asynchronous Processing
6. External Integrations

This allows the project to stay small while making future extraction of high-load components possible.

**Do not introduce microservices solely to make the architecture look sophisticated.**

## 3. Deployment target

### ADR-002: Cloudflare is the production application platform

NextAction will not target Vercel.

The full-stack web application is intended to run on **Cloudflare Workers**.

Cloudflare's current documentation recommends **vinext** as the default deployment path for new Next.js applications on Workers; OpenNext remains documented primarily for existing OpenNext applications. The existing Next.js project must pass a compatibility check before any migration is performed.

This architecture decision is about the deployment target. It does not authorize an immediate framework migration in this phase.

## 4. System topology

```mermaid
flowchart LR
    U[User] --> WEB[NextAction Web / Control Plane]
    P[Publisher SaaS] --> ING[/track]
    P --> DEC[/offer]
    U --> CLK[/click]

    WEB --> AUTH[Supabase Auth]
    WEB --> DB[Supabase Postgres]

    ING --> Q[Async Queue]
    Q --> N[Event Normalizer]
    N --> DB

    DEC --> D[Decision Engine]
    D --> DB

    CLK --> V[Click Qualification]
    V --> S[Settlement Transaction]
    S --> DB

    WEB --> LLM[Product Analyzer]
```

The diagram is conceptual. Components may be deployed in the same Worker/application initially.

## 5. Control Plane vs Runtime Plane

### Control Plane

Responsible for human-facing configuration:
- landing and activation
- authentication
- product understanding confirmation
- capability selection
- capability-specific setup
- verification state
- dashboard
- offer management
- workspace/product configuration

Control-plane operations can tolerate normal web-app latency.

### Runtime Plane

Responsible for publisher-facing execution:
- receive Events
- normalize Events into Moments
- make Decisions
- produce Deliveries
- receive Clicks
- qualify Clicks
- execute Settlement

Runtime operations must be isolated from user-session assumptions.

The Runtime Plane must not require a Supabase Auth session from the end user of a publisher SaaS.

## 6. Domain Core

The domain core contains pure business concepts and rules and must not depend directly on:
- Next.js
- React
- Supabase client APIs
- Cloudflare APIs
- HTTP Request/Response objects
- LLM SDKs

Core modules should be organized around domain behavior rather than database tables.

Conceptual use cases:
- AnalyzeProduct
- ConfirmProductUnderstanding
- SelectCapabilities
- RegisterMoment
- TrackEvent
- NormalizeEventToMoment
- DecideOffer
- RecordDelivery
- RecordClick
- QualifyClick
- SettleQualifiedClick

The domain core owns invariants. Infrastructure adapters own transport and persistence.

## 7. Application layer

The application layer orchestrates domain use cases and transaction boundaries.

Responsibilities:
- authorization checks
- command validation
- repository calls
- queue publishing
- idempotency handling
- invoking domain policies
- converting domain results to API DTOs

The application layer must not expose database rows as its public contract.

## 8. Infrastructure layer

Infrastructure adapters provide:
- Supabase database repositories
- narrow Postgres/RPC calls
- authentication adapter
- queue adapter
- LLM provider adapter
- URL fetching/scanning adapter
- signed runtime credential verification
- observability adapter

Business rules must not be placed in these adapters merely because the implementation is convenient.

## 9. Database architecture

Supabase Postgres is the system of record.

The database is divided conceptually into:

### Configuration / control data
Mutable by authorized workspace members:
- workspaces
- products
- capabilities
- moments
- offers
- advertiser capacity configuration

### Runtime records
Append-oriented operational records:
- events
- decisions
- deliveries
- clicks
- qualified clicks

### Financial records
Immutable or append-only accounting data:
- settlements
- advertiser debit ledger
- publisher credit ledger

Financial history must not be represented only by mutable counters.

Counters such as remaining capacity can exist as projections/cacheable state, but the settlement ledger remains authoritative.

## 10. Database source of truth

All schema changes must be represented by versioned migrations committed to GitHub.

Target repository structure:

```
supabase/
  migrations/
    <timestamp>_<change>.sql
```

Production Supabase should be reproducible from repository migrations.

Manual SQL-editor changes must not become the permanent source of schema truth.

The current `schema.sql` is a prototype/reference artifact and must not remain the only database definition.

## 11. Tenant isolation

Every tenant-owned domain record must be traceable to a workspace.

Recommended ownership path:

```
workspace
  -> product
     -> moment
     -> runtime configuration
  -> offer
  -> financial/accounting records
```

User-facing control-plane tables should use RLS.

Policies should:
- target the `authenticated` role explicitly
- use `(select auth.uid())` where appropriate
- include ownership checks
- provide `WITH CHECK` for updates
- have supporting indexes for policy predicates

Public runtime traffic must not receive unrestricted direct table access.

## 12. Runtime authentication

Publisher runtime calls must use an integration credential scoped to the publisher/product.

Runtime identity is therefore:

**integration credential -> product -> workspace**

not:

**anonymous end-user -> workspace**

The end user's identity is not required for contextual matching.

Secrets must only be verified server-side. No service-role credential may be exposed to browsers or shipped to publisher clients.

## 13. Event architecture

An Event is the raw technical signal.

Events enter the system through an asynchronous boundary.

Required behavior:

```
publisher
  -> /track
  -> validate envelope
  -> accept quickly
  -> enqueue
  -> normalize
  -> persist Event
  -> resolve canonical Moment
```

`/track` must not synchronously perform expensive LLM work or complex decisioning.

The Event envelope should contain a publisher-generated idempotency identifier.

Duplicate delivery of the same Event must be safe.

## 14. Moment architecture

Moment is the canonical semantic object.

A Moment is not merely an arbitrary event name.

A Moment must have:
- stable machine identifier
- human-readable label
- product scope
- active/inactive lifecycle
- sufficient metadata to explain its semantic meaning

Normalization may map multiple raw Events to one canonical Moment.

Moment definitions are configuration/domain data; individual Event occurrences are runtime data.

## 15. Decision architecture

Decision is server-authoritative.

A Decision answers:

> Should an eligible Offer be delivered for this Moment now?

Decisioning may consider:
- Moment compatibility
- Offer state
- advertiser capacity
- eligibility rules
- frequency/duplication constraints when later introduced
- policy/safety checks

The Decision service must not mutate financial state merely because an offer was selected.

## 16. Delivery architecture

Delivery records the fact that an Offer was made available to a publisher surface.

Delivery is distinct from Decision.

This distinction is required for later analysis of:
- no-fill
- selected-but-not-rendered
- rendered
- clicked

Publisher integration should receive raw JSON by default.

HTML/widget rendering is not a core dependency.

## 17. Click and Qualification architecture

A Click represents user interaction with a Delivery.

Qualification is a separate server-side step.

The client must not be able to assert:
- that a click is qualified
- what it costs
- what the publisher earns
- what the advertiser spent

A signed click token may carry the minimum information necessary to connect the click to the Delivery, but all qualification decisions remain server-authoritative.

## 18. Settlement architecture

Settlement is a database transaction, not an application-side sequence of independent updates.

Atomic invariant:

```
Qualified Click
    -> advertiser debit $1.00
    -> publisher credit $0.75
    -> NextAction revenue $0.25
    -> one immutable Settlement
```

Required properties:
- atomic
- idempotent
- server-authoritative
- auditable

A unique idempotency constraint must make duplicate settlement impossible.

If any required accounting operation fails, the transaction must not partially commit.

## 19. Balance model

MVP may manually provision advertiser capacity such as:

```
$25 capacity = 25 Qualified Clicks
```

This is an initial funding mechanism, not a replacement for the domain's financial model.

The production model must distinguish:
- capacity granted
- capacity reserved/consumed
- advertiser debits
- publisher credits
- platform revenue

Mutable `spent_cents` counters are projections, not the sole audit trail.

## 20. API contract

Public API behavior should be defined by explicit request/response schemas.

Minimum logical runtime endpoints:

### /track
Purpose: accept raw publisher Event.

Expected behavior:
- authenticated by integration credential
- validate envelope
- enqueue asynchronously
- return quickly
- never perform settlement

### /offer
Purpose: request an Offer Decision for a Moment.

Expected behavior:
- authenticated by integration credential
- low latency
- return JSON delivery on fill
- return `204 No Content` on no-fill or protected timeout/failure path
- never charge the advertiser merely for decisioning

### /click
Purpose: process a click against a Delivery.

Expected behavior:
- validate signed state
- determine qualification
- execute settlement when qualified
- never trust client-supplied price/qualification values
- redirect only according to a server-authorized destination

## 21. Product analysis architecture

Product analysis happens before authentication in the intended UX.

Because the URL is untrusted public input, the analysis path must be treated as an abuse/security boundary.

Architecture requirements:
- URL normalization
- HTTP(S)-only policy
- SSRF protection
- redirect validation
- DNS/IP safety checks as appropriate
- timeout limit
- response-size limit
- content-type checks
- rate limiting / abuse controls
- bounded LLM input
- structured output validation

The analyzer returns **proposed product understanding**, not persisted product truth.

Persistence occurs only after the user confirms the result and authentication is available.

## 22. Onboarding state architecture

The activation state must be modeled explicitly rather than inferred from page navigation.

Canonical states:

```
URL
-> Product Understanding
-> Confirmed Product
-> Intent Selected
-> Capability Setup
-> Verification
-> Truly Ready
-> Dashboard
```

Authentication is conditional and must not redefine the sequence.

Pre-auth state may be ephemeral.

Once authenticated, durable activation state belongs to the workspace/product domain.

## 23. Failure philosophy

NextAction has two different failure postures.

### Host-safe runtime failure

For publisher-facing decisioning:
- prefer no-fill over degrading the host SaaS
- timeouts must be bounded
- upstream failures must fail closed for billing and fail open for publisher UX

### Financial failure

For settlement:
- prefer no settlement over ambiguous settlement
- never partially debit or partially credit
- retry only with idempotency

These are intentionally different policies.

## 24. Performance architecture

The critical latency path is:

```
publisher -> /offer -> Decision -> response
```

It must avoid:
- LLM calls
- synchronous queue work
- expensive scans
- unnecessary database round trips
- user authentication flows

The exact latency SLO will be established during performance benchmarking rather than guessed into the architecture.

The existing MVP plan's `<100ms` target is therefore treated as a benchmark target, not a guaranteed architectural fact.

## 25. Observability

Every runtime request must carry a correlation identifier.

The system should make it possible to trace:

```
Event
  -> Moment
  -> Decision
  -> Delivery
  -> Click
  -> Qualified Click
  -> Settlement
```

Minimum observability fields:
- request_id
- workspace_id
- product_id
- integration_id
- event_id
- moment_id
- decision_id
- delivery_id
- click_id
- settlement_id
- outcome
- latency
- error classification

Financial records require stronger auditability than ordinary request logs.

## 26. Testing architecture

Testing follows the domain boundaries.

### Unit
Pure domain rules:
- event normalization
- moment matching
- qualification rules
- settlement allocation

### Integration
Database behavior:
- RLS isolation
- unique/idempotency constraints
- transaction behavior
- settlement atomicity
- repository correctness

### Contract/API
Request/response schemas:
- malformed payloads
- unauthorized requests
- invalid credentials
- no-fill semantics
- signed token validation

### End-to-end
Critical journeys:
- URL activation
- Make Money setup
- Reach Customers setup
- publisher event -> moment -> delivery -> click -> settlement
- advertiser capacity -> offer -> qualified click -> debit

### Performance
Critical runtime:
- /offer latency
- /track acceptance latency
- settlement contention
- queue processing delay

## 27. CI/CD architecture

GitHub remains the code source of truth.

The CI system must gate merges on at least:
- dependency installation
- lint
- typecheck
- unit/integration tests
- production build
- database migration validation
- critical browser E2E
- security-sensitive checks

The repository now contains `.circleci/config.yml`, including the Stage 15 `product_scanner_security` gate and the existing Cloudflare compatibility/build and release-gate jobs. The verified Stage 15 `master` baseline had successful CircleCI status checks for `quality`, `product_scanner_security`, `cloudflare_compatibility`, and `cloudflare_build`.

The earlier “CI state unknown” statement was part of the pre-Stage-14 baseline and is no longer current.

## 28. Environment architecture

Minimum environments:

```
local
staging
production
```

Rules:
- no production secrets in Git
- no production database used for local development
- migrations tested before production
- staging validates runtime behavior
- production deploys are reproducible from GitHub

## 29. Explicit non-decisions

The following are deliberately not locked yet:
- exact queue provider implementation
- exact SQL table names for every future runtime record
- exact integration credential format
- exact rate-limit vendor
- exact observability vendor
- payment gateway
- automatic publisher payouts
- widget/HTML delivery
- advanced targeting and frequency controls

Those decisions belong in later ADRs when their requirements are known.

## 30. Architecture invariants

Any future implementation must preserve these invariants:

1. Moment remains the core semantic primitive.
2. Event, Moment, Decision, Delivery, Click, Qualified Click, and Settlement remain distinct.
3. Financial qualification is server-authoritative.
4. Settlement is atomic and idempotent.
5. Runtime traffic does not depend on end-user Supabase Auth.
6. Public URL analysis is treated as untrusted input.
7. Publisher-hosted UX is fail-open.
8. GitHub migrations are the database source of truth.
9. Application code remains modular and domain-driven.
10. Cloudflare is the intended application deployment platform, not Vercel.

## 31. Implementation gate

Architecture work is considered complete only when the next implementation phase can answer these questions without ambiguity:

- Where does this rule live?
- Which layer owns this decision?
- Which data is mutable vs immutable?
- Who is trusted to assert the state?
- What happens on timeout?
- What happens on retry?
- What is the idempotency key?
- Which transaction boundary protects money?
- Which environment owns this secret?
- How is the behavior tested?

If an implementation cannot answer those questions, it is not ready to be built.

## 31. Stage 15 product scanner implementation

The Product Analysis architecture now has an executable server-side scanner boundary.

The scanner uses Cloudflare Workers-compatible node:dns resolution for A and AAAA validation, followed by controlled Fetch API retrieval with manual redirects, bounded HTML parsing, and explicit resource limits.

The architecture deliberately distinguishes DNS preflight validation from connection-level destination pinning. Standard Worker fetch does not provide a general mechanism to force an arbitrary public hostname to the exact IP returned by a prior DNS query, so the implementation does not claim that guarantee.

Strict IP-pinned egress remains a separate future infrastructure decision if product requirements make that guarantee necessary.

## 32. H3.1 Network Moment architecture amendment

Moment remains product-scoped. A platform-owned Network Moment supplies the semantic identity needed for cross-product matching.

Runtime resolution is server-side:

```text
integration credential
  → Product
  → Product Moment
  → Network Moment
  → eligible Offers
  → Decision
  → Delivery
```

Network Moment is taxonomy/configuration data, not a lifecycle stage. No end-user identity layer is introduced.

The network semantic lookup must remain inside the existing `/v1/offer` latency boundary and must not add LLM calls, scanner work, slow queues, or end-user authentication.

Existing product-scoped `offer_moments` relations remain valid during additive migration; new network targeting is introduced through a separate normalized relation.
