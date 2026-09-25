# NextAction Production Data Model & Migration Blueprint

**Status:** Authoritative v1 blueprint
**Depends on:** Product Truth, Architecture Truth, Data & Security Truth, API & Contract Truth
**Observed Supabase project:** khoygjyikxkdwonygzyh
**Observed PostgreSQL:** 17.6
**Date:** 2026-09-26

## 1. Purpose

This document turns the approved product, architecture, data/security, and API truths into a concrete production database blueprint.

It defines target tables, relationships, ownership, constraints, idempotency, financial integrity, indexing, RLS/grants, and migration order.

This is a blueprint only. No live DDL is executed by Stage 5.

## 2. Current live database baseline

The live project currently contains four public application tables:

~~~text
public.workspaces
public.products
public.moments
public.offers
~~~

All four have RLS enabled.

Observed data:

~~~text
workspaces = 2
products   = 3
moments    = 15
offers     = 0
~~~

The live project currently has zero recorded migrations and no public application triggers.

The current prototype schema is therefore treated as a data-preservation starting point, not the final model.

## 3. Namespace strategy

Use two logical database surfaces.

### public

User-facing control-plane data that can be queried through the Supabase Data API with explicit authenticated-user RLS:

~~~text
workspaces
workspace_members
workspace_capabilities
products
moments
integrations
offers
offer_moments
~~~

### private

Internal runtime, credential, and financial data:

~~~text
integration_secrets
events
moment_occurrences
decisions
deliveries
clicks
qualified_clicks
advertiser_credit_accounts
advertiser_credit_entries
financial_accounts
financial_entries
settlements
~~~

Sensitive runtime and financial data must not be directly exposed as ordinary Data API CRUD.

## 4. Entity relationship model

~~~text
auth.users
   |
   +---< workspace_members >--- workspaces
                                  |
                  +---------------+-------------------+
                  |               |                   |
             capabilities      products             offers
                                  |                   |
                               moments          offer_moments
                                  |
                          moment_occurrences
                                  |
                                events
                                  |
                               decisions
                                  |
                               deliveries
                                  |
                                clicks
                                  |
                          qualified_clicks
                                  |
                             settlements
                              /    |    \
                             /     |     \
                       advertiser publisher platform
                        ledger      ledger   ledger
~~~

The Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement chain remains explicit.

## 5. Workspace model

### public.workspaces

Purpose: tenant boundary.

Target columns:
- id uuid primary key
- name text not null
- created_at timestamptz not null
- optional lifecycle fields

Production ownership is not represented solely by a nullable user_id column.

### public.workspace_members

Purpose: authenticated membership.

Target columns:
- workspace_id uuid not null
- user_id uuid not null
- role text not null
- created_at timestamptz not null

Allowed MVP roles:
- owner
- member

Constraint:
- unique (workspace_id, user_id)

Ordinary user writes cannot transfer ownership arbitrarily.

## 6. Capability model

### public.workspace_capabilities

Purpose: persist activation intent.

Target columns:
- workspace_id uuid not null
- capability text not null
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Allowed capabilities:
- make_money
- reach_customers

Both may be active simultaneously.

Constraint:
- unique (workspace_id, capability)

## 7. Product model

### public.products

Purpose: confirmed product identity.

Target columns:
- id uuid primary key
- workspace_id uuid not null
- canonical_url text not null
- domain text not null
- name text not null
- description text
- understanding_status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Suggested statuses:
- proposed
- confirmed
- archived

Constraint:
- unique (workspace_id, canonical_url)

URL normalization happens before persistence.

## 8. Moment definition model

### public.moments

Purpose: canonical semantic Moment definitions.

Target columns:
- id uuid primary key
- product_id uuid not null
- moment_key text not null
- label text not null
- description text
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Suggested statuses:
- active
- disabled

Constraint:
- unique (product_id, moment_key)

A Moment definition is configuration, not a runtime occurrence.

## 9. Integration model

### public.integrations

Purpose: publisher integration metadata.

Target columns:
- id uuid primary key
- product_id uuid not null
- name text not null
- status text not null
- created_at timestamptz not null
- revoked_at timestamptz
- last_seen_at timestamptz

Suggested statuses:
- active
- revoked

### private.integration_secrets

Purpose: credential verification data.

Target columns:
- integration_id uuid primary key
- credential_hash text not null
- created_at timestamptz not null
- rotated_at timestamptz

Rules:
- raw secrets are never returned by ordinary reads
- browser code never receives secret verification material
- revoked integrations cannot authenticate runtime requests

## 10. Offer model

### public.offers

Purpose: advertiser offer configuration.

Target columns:
- id uuid primary key
- workspace_id uuid not null
- title text not null
- description text
- cta_label text not null
- destination_url text not null
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Suggested statuses:
- draft
- active
- paused
- exhausted
- archived

### public.offer_moments

Purpose: relational Offer-to-Moment targeting.

Target columns:
- offer_id uuid not null
- moment_id uuid not null
- created_at timestamptz not null

Constraint:
- unique (offer_id, moment_id)

The production model must not depend on a free-form target_moments text array.

Cross-tenant targeting must be rejected.

## 11. Event model

### private.events

Purpose: raw publisher technical signal.

Target columns:
- id uuid primary key
- integration_id uuid not null
- idempotency_key text not null
- event_type text not null
- occurred_at timestamptz
- payload jsonb not null
- received_at timestamptz not null
- processing_status text not null
- request_id uuid

Suggested processing statuses:
- accepted
- processing
- processed
- failed

Critical constraint:
- unique (integration_id, idempotency_key)

Payload size is bounded at the API boundary.

## 12. Moment occurrence model

### private.moment_occurrences

Purpose: concrete occurrence of a canonical Moment.

Target columns:
- id uuid primary key
- moment_id uuid not null
- event_id uuid
- integration_id uuid not null
- occurred_at timestamptz not null
- metadata jsonb

The occurrence references the Moment definition without modifying it.

## 13. Decision model

### private.decisions

Purpose: server-authoritative decision record.

Target columns:
- id uuid primary key
- moment_occurrence_id uuid
- integration_id uuid not null
- outcome text not null
- offer_id uuid
- reason_code text
- created_at timestamptz not null
- request_id uuid

Suggested outcomes:
- filled
- no_fill
- rejected
- error

A Decision never settles money.

## 14. Delivery model

### private.deliveries

Purpose: record actual Offer Delivery.

Target columns:
- id uuid primary key
- decision_id uuid not null
- offer_id uuid not null
- integration_id uuid not null
- delivery_nonce text not null
- delivery_token_hash text not null
- expires_at timestamptz
- created_at timestamptz not null

Constraints:
- unique delivery_nonce
- unique delivery_token_hash

The publisher receives only an opaque signed token.

## 15. Click model

### private.clicks

Purpose: record user interaction with a Delivery.

Target columns:
- id uuid primary key
- delivery_id uuid not null
- click_token_hash text not null
- clicked_at timestamptz not null
- qualification_status text not null
- verification_result text

Suggested qualification statuses:
- pending
- qualified
- not_qualified
- rejected

Constraint:
- unique click_token_hash

MVP click-replay rule:
A replay of the same signed click opportunity resolves to the same Click rather than creating duplicate economics.

## 16. Qualified Click model

### private.qualified_clicks

Purpose: explicit business state that a Click passed qualification.

Target columns:
- id uuid primary key
- click_id uuid not null
- qualification_version text not null
- reason_code text
- qualified_at timestamptz not null

Constraint:
- unique click_id

One Click therefore produces at most one Qualified Click.

## 17. Advertiser capacity model

### private.advertiser_credit_accounts

Purpose: available Qualified Click capacity.

Target columns:
- workspace_id uuid primary key
- granted_units integer not null
- consumed_units integer not null
- available_units integer not null
- updated_at timestamptz not null

Invariant:

~~~text
available_units = granted_units - consumed_units
~~~

Constraints:
- granted_units >= 0
- consumed_units >= 0
- available_units >= 0

MVP example:

~~~text
25 granted units = 25 Qualified Click capacity
~~~

### private.advertiser_credit_entries

Purpose: immutable capacity audit trail.

Target columns:
- id uuid primary key
- workspace_id uuid not null
- entry_type text not null
- units integer not null
- reference_id uuid
- created_at timestamptz not null

Suggested entry types:
- grant
- consumption
- adjustment

Payment gateway integration remains deferred.

## 18. Financial accounts

### private.financial_accounts

Purpose: internal accounting accounts.

Target columns:
- id uuid primary key
- owner_type text not null
- workspace_id uuid
- account_type text not null
- currency text not null default USD
- created_at timestamptz not null

Owner types:
- workspace
- platform

Account types:
- advertiser_spend
- publisher_earnings
- platform_revenue

## 19. Financial ledger

### private.financial_entries

Purpose: immutable accounting entries created by settlement.

Target columns:
- id uuid primary key
- settlement_id uuid not null
- account_id uuid not null
- entry_type text not null
- amount_cents integer not null
- created_at timestamptz not null

Constraints:
- amount_cents > 0
- immutable after posting

Suggested entry types:
- debit
- credit

The ledger is the audit source; aggregate balances are projections.

## 20. Settlement model

### private.settlements

Purpose: immutable financial outcome of one Qualified Click.

Target columns:
- id uuid primary key
- qualified_click_id uuid not null
- advertiser_workspace_id uuid not null
- publisher_workspace_id uuid not null
- charge_cents integer not null
- publisher_share_cents integer not null
- platform_share_cents integer not null
- currency text not null default USD
- settled_at timestamptz not null

Critical constraints:
- unique qualified_click_id
- charge_cents > 0
- publisher_share_cents >= 0
- platform_share_cents >= 0
- publisher_share_cents + platform_share_cents = charge_cents

MVP invariant:

~~~text
charge_cents          = 100
publisher_share_cents = 75
platform_share_cents  = 25
~~~

## 21. Settlement transaction

The financial transaction must be atomic:

~~~text
lock advertiser capacity account
  ↓
verify available capacity > 0
  ↓
create/reuse Qualified Click
  ↓
create Settlement
  ↓
create advertiser debit ledger entry
  ↓
create publisher credit ledger entry
  ↓
create platform revenue ledger entry
  ↓
consume advertiser capacity
  ↓
commit
~~~

Required outcome:

~~~text
1 Qualified Click
1 Settlement
1 advertiser debit
1 publisher credit
1 platform revenue entry
1 capacity consumption
~~~

Any failure rolls back the entire financial outcome.

## 22. Critical uniqueness constraints

Database-enforced uniqueness must exist for:

~~~text
workspace_members
  (workspace_id, user_id)

workspace_capabilities
  (workspace_id, capability)

products
  (workspace_id, canonical_url)

moments
  (product_id, moment_key)

offer_moments
  (offer_id, moment_id)

events
  (integration_id, idempotency_key)

deliveries
  (delivery_token_hash)

clicks
  (click_token_hash)

qualified_clicks
  (click_id)

settlements
  (qualified_click_id)
~~~

Application checks alone are insufficient.

## 23. Index strategy

Required baseline indexes include:

Ownership and RLS:
- workspace_members(user_id)
- products(workspace_id)
- moments(product_id)
- offers(workspace_id)

Targeting/runtime:
- offer_moments(moment_id)
- integrations(product_id, status)
- events(integration_id, received_at desc)
- moment_occurrences(moment_id, occurred_at desc)
- decisions(integration_id, created_at desc)
- deliveries(integration_id, created_at desc)

Financial/audit:
- advertiser_credit_entries(workspace_id, created_at desc)
- financial_entries(settlement_id)
- financial_accounts(workspace_id, account_type)
- settlements(advertiser_workspace_id, settled_at desc)
- settlements(publisher_workspace_id, settled_at desc)

These indexes address the current missing-FK-index findings where applicable.

## 24. RLS and grants

Public control-plane tables:
- RLS enabled
- policies explicitly targeted to authenticated
- workspace membership is the ownership boundary

Anonymous role target:
~~~text
anon -> no direct tenant-table privileges
~~~

Authenticated role target:
~~~text
authenticated -> control plane only, constrained by RLS
~~~

Privileged server path:
~~~text
server-only -> internal runtime/financial operations
~~~

No browser code or publisher code may contain a Supabase service-role secret.

## 25. Ownership rule

For every control-plane operation:

~~~text
authenticated user
   ↓
workspace_members
   ↓
workspace
   ↓
child resource
~~~

Client-supplied workspace_id is never proof of ownership.

## 26. RLS performance rules

RLS policies should:
- explicitly specify TO authenticated
- use (select auth.uid()) for stable auth expressions
- index policy predicate columns
- minimize expensive joins
- use explicit application filters

These rules directly address current Supabase advisor findings.

## 27. Immutability policy

Immutable after posting:
- Event occurrence history
- Decision business outcome
- Delivery token identity
- Qualified Click
- Settlement
- financial ledger entries
- advertiser credit entries

Mutable configuration:
- workspace name
- product metadata/status
- Moment metadata/status
- Offer configuration/status
- integration metadata

Business history must not be rewritten to alter economics.

## 28. Retention

Configuration is long-lived according to product policy.

Runtime event/decision/delivery data is retained according to operational, analytics, abuse, and reconciliation needs.

Financial records are not subject to normal runtime cleanup.

Exact retention periods remain intentionally open.

## 29. Migration strategy

The remote database already contains data but zero migration history.

Therefore the first migration action is baseline capture, not destructive rebuild.

Recommended order:

### Migration 0001 — remote baseline
Capture the current remote schema into version control using the Supabase migration workflow.

The baseline represents today's remote database.

### Migration 0002 — access hardening
- reduce unnecessary anon privileges
- add explicit authenticated policies
- optimize auth.uid usage
- add required ownership indexes

### Migration 0003 — workspace normalization
- add workspace_members
- backfill current workspace owners
- establish non-null ownership path

### Migration 0004 — capability and product normalization
- add workspace_capabilities
- add product status/confirmation
- establish canonical URL/domain fields

### Migration 0005 — Moment normalization
- add Moment lifecycle/metadata
- preserve product + moment_key uniqueness

### Migration 0006 — integrations
- add integration metadata
- add private credential verification
- add revocation/rotation

### Migration 0007 — offers
- add relational offer_moments
- migrate away from target_moments array
- remove dependence on mutable spent counters
- validate destination persistence

### Migration 0008 — runtime domain
- events
- moment_occurrences
- decisions
- deliveries
- clicks
- qualified_clicks

### Migration 0009 — advertiser capacity
- advertiser_credit_accounts
- advertiser_credit_entries
- non-negative constraints

### Migration 0010 — financial model
- financial_accounts
- financial_entries
- settlements
- atomic settlement transaction/function

### Migration 0011 — cleanup
After application cutover:
- remove deprecated columns
- remove obsolete policies
- remove obsolete indexes

Each migration must be independently reviewable and testable.

## 30. Existing data preservation

Current data is:

~~~text
2 workspaces
3 products
15 moments
0 offers
~~~

Preservation rules:
- preserve IDs where practical
- preserve timestamps
- preserve product-to-workspace relationships
- preserve existing Moment keys
- backfill workspace membership from existing ownership
- do not silently invent offer targeting data

Since offers currently equal zero, there is no existing target_moments dataset that needs automatic conversion.

## 31. Migration safety

Never:
- drop live tables before replacement data is verified
- rewrite business identifiers without backfill
- rewrite financial history
- deploy settlement tables without idempotency constraints
- rely on SQL-editor-only changes
- assume migration success means application compatibility

Required order:

~~~text
write in Git
  ↓
local database
  ↓
tests
  ↓
staging
  ↓
Supabase advisors
  ↓
production
~~~

## 32. Database test requirements

Ownership:
- user A cannot read user B data
- user A cannot insert into user B workspace
- users cannot transfer ownership through CRUD

Capabilities:
- valid single capability
- valid Both
- invalid value rejected
- duplicate rejected

Moments:
- duplicate Moment key rejected within product
- same key allowed across different products

Events:
- duplicate integration + idempotency key is safe
- same idempotency key across different integrations is allowed

Clicks:
- replaying the same click token does not create new economics

Settlement:
- one Qualified Click cannot settle twice
- advertiser capacity cannot become negative
- allocation always equals charge
- rollback produces no partial financial entries

## 33. Advisor gate

After each schema/security migration, inspect Supabase advisors.

Known current findings:
- leaked password protection disabled
- RLS auth initialization-plan findings
- missing foreign-key indexes

These findings must either be fixed or explicitly accepted with a documented reason before launch.

## 34. Generated database types

After the production schema exists, generated database types should be produced from the actual schema and checked by CI.

Hand-maintained database interfaces should not become a second incompatible source of truth.

## 35. Stage 5 exit criteria

Stage 5 is complete as a blueprint when:
- every production domain object has a table
- every table has a clear owner
- every table has a visibility boundary
- every table has a writer
- every sensitive table has a trust boundary
- every idempotency boundary has a database constraint
- every financial transition has a transaction definition
- every RLS relationship has supporting indexes
- migration order is explicit
- current data has a preservation strategy
- no live DDL is required to interpret the design

Only after this blueprint is accepted should actual Supabase migrations be written.
