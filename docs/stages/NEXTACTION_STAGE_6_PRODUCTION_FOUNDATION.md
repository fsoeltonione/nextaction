# NextAction Stage 6 — Production Foundation Implementation

**Status:** Implemented and live-verified  
**Date:** 2026-09-26  
**Repository:** `fsoeltonione/nextaction`  
**Supabase project:** `khoygjyikxkdwonygzyh`

## 1. Objective

Stage 6 converts the Stage 5 production data blueprint into the first deployable database foundation without adding product behavior.

The implementation preserves the existing prototype data and establishes the control-plane, runtime, credential, and financial boundaries required by the locked NextAction model.

## 2. GitHub implementation

Stage 6 lives on branch:

`stage-6-production-foundation`

Implemented migration files:

```text
supabase/migrations/20260925205217_stage_6_production_foundation.sql
supabase/migrations/20260925205428_stage_6_hardening.sql
supabase/migrations/20260925205723_stage_6_advisor_cleanup.sql
```

Generated database types:

```text
src/lib/database.types.ts
```

The migration filenames match the migration versions recorded by the live Supabase project.

## 3. Database foundation implemented

### Public control plane

```text
workspaces
workspace_members
workspace_capabilities
products
moments
integrations
offers
offer_moments
```

### Private runtime and financial plane

```text
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
```

The Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement chain is represented explicitly.

## 4. Existing data preservation

Before Stage 6:

```text
workspaces = 2
products   = 3
moments    = 15
offers     = 0
```

After Stage 6:

```text
workspaces = 2
workspace_members = 2
products = 3
moments = 15
offers = 0
```

Runtime and financial tables remain empty.

Existing product relationships, Moment keys, identifiers, and timestamps were preserved.

## 5. Security implementation

Public control-plane tables now:

- require explicit authenticated-role policies
- use workspace membership as the authorization boundary
- use `(select auth.uid())` through the internal authorization helper
- no longer grant table privileges to `anon`

Private runtime/financial tables:

- are outside the exposed control-plane schema
- deny access to `anon` and `authenticated`
- are intended for server-only access
- have RLS enabled as defense in depth

Integration credentials are stored as verification hashes in `private.integration_secrets`; raw credentials are not part of ordinary public reads.

Offer targeting is relational through `offer_moments`, with a database trigger rejecting cross-workspace targeting.

## 6. Financial integrity

The database enforces the MVP settlement invariant:

```text
charge_cents          = 100
publisher_share_cents = 75
platform_share_cents  = 25
```

Additional invariants include:

- one Qualified Click → at most one Settlement
- settlement shares must sum to the charge
- advertiser available capacity cannot become negative
- qualified clicks, settlements, and ledger entries are immutable
- duplicate event idempotency keys are unique per integration

## 7. Verification performed

Verified against live Supabase:

### Tenant isolation

Authenticated user simulation produced:

```text
User A: 1 workspace, 1 product, 5 moments
User B: 1 workspace, 2 products, 10 moments
```

No cross-tenant rows were visible.

### Private access

```text
anon -> public tenant SELECT: denied
authenticated -> private schema USAGE: denied
authenticated -> private.events SELECT: denied
```

### Cross-tenant targeting

Attempting to associate an Offer with a Moment belonging to another workspace was rejected by the database trigger.

### Settlement invariants

Invalid settlement economics were rejected.

Valid MVP economics were accepted.

### Immutability

Updating a settlement after creation was rejected.

All verification was performed transactionally; test rows were rolled back.

## 8. Supabase advisor status

Current security advisor findings are:

1. Leaked Password Protection remains disabled in Supabase Auth.
2. Private tables have RLS enabled without public policies. This is intentional defense-in-depth because those tables are not granted to `anon` or `authenticated`.

Current performance advisor findings no longer report missing foreign-key indexes.

The remaining unused-index notices are expected for newly-created or empty tables and should be re-evaluated after real workload exists.

## 9. Important migration note

The current production database had pre-existing tables but no migration history.

To avoid destructive reconstruction, Stage 6 was applied additively to the existing project and the corresponding migration versions were recorded in Supabase.

The live migration history is now:

```text
20260925205217  stage_6_production_foundation
20260925205428  stage_6_hardening
20260925205723  stage_6_advisor_cleanup
```

Future schema changes must use Git-tracked migration files rather than SQL-editor-only changes.

## 10. Known boundary

There is currently no separate Supabase staging project/branch and no CircleCI configuration in the repository.

Therefore Stage 6 establishes the production database foundation and verifies it live, but the full local → staging → production deployment gate is not yet operational.

The next implementation stage should build the application/runtime against this foundation rather than reintroducing prototype persistence patterns.
