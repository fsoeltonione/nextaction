# NextAction Data & Security Truth

**Status:** Authoritative v1  
**Depends on:** `docs/NEXTACTION_PRODUCT_DOMAIN_TRUTH.md`, `docs/architecture/NEXTACTION_ARCHITECTURE_TRUTH.md`  
**Observed Supabase project:** `khoygjyikxkdwonygzyh`  
**Date:** 2026-09-26

## 1. Purpose

This document defines the authoritative data, authorization, trust, idempotency, and financial-integrity rules for NextAction.

It describes the target production model. It does not apply database DDL or modify the live Supabase schema.

## 2. Current database baseline

The live Supabase project currently has four public application tables:

`workspaces`, `products`, `moments`, `offers`.

All four have RLS enabled.

Observed indexes currently cover only primary keys plus the unique index on `moments(product_id, moment_key)`. The three foreign keys flagged by Supabase are not covered by dedicated indexes.

The live database has no recorded migrations and no public application triggers.

Current RLS policies do not explicitly restrict policies to the `authenticated` role. The live grants also include broad privileges for the `anon` role. RLS currently prevents unauthorized rows, but role grants should still be reduced to least privilege.

Supabase's current documentation states that grants determine which roles can reach Data API objects and RLS determines which rows those roles can access; both layers therefore matter.

## 3. Data ownership model

The ownership hierarchy is:

```
User
  ↓
Workspace
  ├── Capabilities
  ├── Products
  │     ├── Moments
  │     ├── Integrations
  │     └── Runtime configuration
  ├── Offers
  └── Financial/accounting participation
```

Every user-owned record must have an unambiguous path back to a workspace.

No financial or runtime record may be orphaned from its tenant/workspace context.

## 4. Target data domains

### Workspace / identity

`workspaces`
- id
- name
- owner/user relationship
- lifecycle metadata

`workspace_capabilities`
- workspace_id
- capability: `make_money` or `reach_customers`
- status/lifecycle
- timestamps

A workspace may possess one or both capabilities.

### Product understanding

`products`
- workspace_id
- canonical URL/domain
- name
- description
- confirmation status
- timestamps

The persisted product record represents confirmed user-visible product understanding.

### Moments

`moments`
- product_id
- stable moment_key
- label
- semantic description/metadata
- active status
- timestamps

Uniqueness should be scoped to product and moment key.

### Publisher integrations

A separate integration/credential model is required.

Conceptually:

`integrations`
- product_id
- credential identifier
- credential hash/verification material
- status
- created/revoked timestamps

Raw secrets must not be stored where they can be returned through normal application reads.

### Offers

`offers`
- advertiser workspace/product ownership
- title/description
- CTA label
- destination reference
- status
- commercial capacity reference
- timestamps

Offer-to-Moment matching must use a relational association such as an `offer_moments` table rather than a free-form text array.

## 5. Runtime event model

### Event

`events`

Represents raw technical input from a publisher integration.

Minimum conceptual fields:
- event id
- integration id
- publisher id/product id
- idempotency key
- raw event type
- normalized payload
- received timestamp
- processing status

The raw Event is append-oriented.

Duplicate requests using the same publisher idempotency key must be detected safely.

### Moment occurrence

A Moment definition and a Moment occurrence are different things.

The definition answers:

> What semantic Moment does this product recognize?

The occurrence answers:

> When did this semantic Moment happen?

Runtime occurrence records must therefore reference the canonical Moment definition instead of changing the definition for each occurrence.

## 6. Decision model

`decisions`

Represents the server-authoritative result of a decisioning attempt.

It should reference:
- product/workspace
- moment occurrence or event context
- selected offer, when any
- decision outcome
- reason/category
- timestamp
- request/correlation identifier

Decision must be immutable after the decision is made, except for operational metadata that cannot alter the business result.

Decision does not charge money.

## 7. Delivery model

`deliveries`

Represents an actual offer delivery.

It should reference:
- decision
- offer
- integration/product
- delivery token/state
- delivery outcome
- timestamp

A Decision can exist without a Delivery.

A Delivery can exist only as a consequence of a Decision.

This allows the system to distinguish:
- no-fill
- selected
- delivered
- later clicked

## 8. Click model

`clicks`

Represents a user interaction with a Delivery.

It should reference:
- delivery
- server-generated click id
- received timestamp
- signed-token verification result
- qualification status
- destination handling result

The client cannot declare a click qualified.

## 9. Qualified Click model

`qualified_clicks`

Represents the explicit business state that a Click has passed qualification.

It should reference:
- click
- qualification reason/version
- qualified timestamp
- settlement status

A unique relationship to the Click must prevent the same Click from being qualified more than once.

## 10. Financial model

The financial model must be ledger-first.

Required conceptual objects:

### Advertiser capacity
Tracks how much Qualified Click capacity is available to an advertiser.

### Advertiser debit ledger
Records each advertiser charge.

### Publisher credit ledger
Records each publisher earning.

### Platform revenue ledger
Records the NextAction share.

### Settlement
Connects one Qualified Click to the atomic accounting outcome.

The ledger is the audit source. Aggregate balances are projections.

## 11. Settlement invariant

For one Qualified Click:

```
Advertiser debit   = 100 cents
Publisher credit   = 75 cents
NextAction revenue = 25 cents
Total              = 100 cents
```

All three accounting consequences and the Settlement record must commit atomically.

If any part fails, none of the financial consequences may persist.

## 12. Idempotency model

Idempotency exists at multiple layers.

### Event idempotency
Keyed by publisher-provided event idempotency key within the integration scope.

### Click idempotency
A single client click request must not produce multiple Click records when the same signed delivery state is replayed.

### Qualification idempotency
One Click can produce at most one Qualified Click.

### Settlement idempotency
One Qualified Click can produce at most one Settlement.

The database must enforce the critical uniqueness guarantees, not merely application code.

## 13. Transaction boundaries

### Event ingestion

```
validate -> enqueue
```

Queue acceptance is the transaction boundary for the synchronous request.

### Offer decision

```
authenticate -> load eligibility -> decide -> record Decision/Delivery
```

No financial mutation occurs here.

### Settlement

```
validate Click
  -> qualify
  -> verify capacity
  -> create Settlement
  -> debit advertiser
  -> credit publisher
  -> record platform revenue
  -> commit
```

This must be one database transaction.

## 14. RLS model

Supabase control-plane data is protected with RLS.

Target policy pattern:

```
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id)
```

For descendant records, authorization should resolve ownership through workspace relationships.

RLS policy expressions must be optimized and supported by indexes.

Supabase's current documentation recommends explicit roles, wrapping stable auth functions such as `auth.uid()` in a `select`, and indexing columns used by policies.

## 15. Public runtime access model

Publisher runtime calls are not normal user-authenticated Data API operations.

Runtime access is through an application integration credential.

Therefore:
- runtime records should not be directly writable by `anon`
- sensitive runtime tables should not be broadly exposed through PostgREST
- internal tables/functions should live behind an appropriate schema/permission boundary
- credential verification must happen server-side

Supabase documents using non-exposed schemas such as `private` for internal data and recommends minimum grants for the Data API.

## 16. Role/grant model

Target principle:

### `anon`
Only explicitly public operations required by the landing/analysis surface.

No direct access to tenant, runtime, or financial tables.

### `authenticated`
Only control-plane operations required by the logged-in workspace user, subject to RLS.

No direct financial mutation.

### `service_role` / server-only privileged path
Used only by trusted server-side operations requiring elevated access.

Never exposed to browser code or publisher SDK code.

### Internal database functions
EXECUTE must be explicitly granted only to the intended callers.

Security-definer functions, when necessary, must live outside exposed schemas and have a controlled search path.

## 17. Financial authorization rule

No API request may supply authoritative values for:
- advertiser debit amount
- publisher earning amount
- NextAction revenue share
- qualification state
- settlement state
- remaining financial capacity

Those values are derived from server-side policy and database state.

## 18. Monetary representation

Financial values are represented as integer cents.

Examples:

```
100 cents = $1.00
75 cents  = $0.75
25 cents  = $0.25
```

Avoid floating-point currency arithmetic.

## 19. Destination safety

An offer destination is untrusted configuration until validated.

The system must not allow a click request to overwrite the server-authorized destination by supplying a new URL.

The redirect target must be resolved from the trusted Delivery/Offer state.

## 20. Product-analysis security

The product analyzer is an internet-facing trust boundary.

The persisted Product must originate from:
1. normalized user input
2. controlled retrieval
3. bounded parsing
4. structured model output
5. user confirmation

Required protections include:
- SSRF controls
- redirect controls
- timeout
- response-size limits
- content-type restrictions
- abuse/rate control
- LLM output schema validation

## 21. Migration discipline

The target repository structure is:

```
supabase/
  migrations/
    <timestamp>_<name>.sql
```

Every DDL change must be represented in a migration committed to GitHub.

The production database must be derivable from the repository migration history.

Before any production migration:
- validate syntax
- apply in isolated/staging environment
- run RLS/security tests
- run application integration tests
- verify Supabase advisors

The current live database has zero migration history, so migration bootstrap is a prerequisite to production schema work.

## 22. Current security findings that are not to be ignored

The live project currently reports:
- leaked password protection disabled
- RLS policy performance findings
- missing covering indexes for three foreign keys

These are baseline findings.

They are not being patched during Stage 3 because Stage 3 establishes the target truth before implementation changes.

## 23. Required database invariants

At minimum, the production database must enforce:

1. Workspace ownership cannot be transferred by ordinary user writes.
2. Product belongs to exactly one workspace.
3. Moment definition belongs to exactly one product.
4. Offer belongs to an authorized advertiser workspace.
5. Offer/Moment relationships are valid and relational.
6. Event idempotency is unique within its integration scope.
7. One Click maps to at most one Qualified Click.
8. One Qualified Click maps to at most one Settlement.
9. Settlement allocation sums exactly to the charge.
10. Financial ledger records are immutable after posting.
11. Runtime credentials can be revoked.
12. Runtime secrets are never returned through ordinary reads.

## 24. Security decision summary

NextAction uses defense in depth:

```
HTTP validation
    ↓
Integration authentication
    ↓
Application authorization
    ↓
Postgres constraints
    ↓
RLS / grants
    ↓
Atomic transaction
    ↓
Immutable ledger / audit trail
```

No single layer is treated as sufficient for financial or tenant isolation.

## 25. Stage 13 settlement enforcement

The live runtime now enforces the financial boundary described in this document.

The settlement operation:

- accepts only an internal Qualified Click identifier;
- resolves advertiser and publisher workspaces from server-side Delivery, Offer, Integration, and Product relationships;
- locks the Qualified Click before settlement lookup;
- locks advertiser capacity before consumption;
- derives all monetary values server-side;
- records advertiser debit, publisher credit, platform revenue, and capacity consumption atomically;
- prevents duplicate settlement through database uniqueness;
- exposes the settlement function only to `service_role`;
- does not expose financial tables or mutation controls to browser/public runtime callers.

The financial invariant remains:

```text
100 cents charge
= 75 cents publisher
+ 25 cents platform
```

Failure of any financial write rolls back the entire settlement transaction.

## 26. Stage 13 exit criteria

Stage 13 is complete when the implementation and live database prove:

- qualified Clicks settle atomically;
- capacity cannot be consumed below zero;
- replay does not duplicate financial outcomes;
- financial values are server-derived;
- ledger rows are tied to one immutable Settlement;
- privileged settlement execution is restricted;
- no public client can directly mutate financial state.

## 25. Stage 3 exit criteria

Stage 3 is complete as a specification when the implementation team can identify, for every production table:

- owner
- visibility
- writer
- allowed mutation
- RLS policy
- unique/idempotency constraint
- foreign keys
- indexes
- retention behavior
- audit requirements

And for every financial transition:

- authoritative input
- transaction boundary
- idempotency key
- failure behavior
- immutable record

Only after those are agreed should production migrations be written.
