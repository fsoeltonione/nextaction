# NextAction Stage 9 — Runtime Core

**Status:** Runtime implementation complete on `stage-9-runtime-core`; merge is blocked by GitHub Actions runner availability.  
**Date:** 2026-09-26  
**Baseline:** Stage 8 `master` `a13a19d8c30ac2080f5a7430a2e4e58147f981fe`

## 1. Objective

Stage 9 turns the Stage 8 control plane into an executable publisher runtime while preserving the locked domain chain:

```
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
```

Stage 9 implements:

- `POST /v1/track`
- `POST /v1/offer`
- server-authoritative integration credential resolution
- asynchronous Event processing with PGMQ
- Event → Moment normalization
- Moment-driven Decision → Delivery
- runtime rate limiting
- PostgreSQL worker scheduling
- CI quality gates
- manual staging smoke gate

Click, Qualified Click, and Settlement remain later milestones.

## 2. Runtime boundary

Publisher requests authenticate with:

```
Authorization: Bearer <integration-token>
```

The token is hashed before lookup. Runtime application code does not directly read the private credential table; it calls a service-role-only database function.

The resolved integration determines:

```
integration → product → workspace
```

The client cannot replace that identity.

## 3. /v1/track

Contract:

```
POST /v1/track
Authorization: Bearer <integration-token>
Idempotency-Key: <opaque-key>
Content-Type: application/json
```

Body:

```json
{
  "type": "invoice.created",
  "occurred_at": "2026-09-26T10:20:30Z",
  "data": {
    "invoice_id": "opaque-publisher-id"
  }
}
```

Behavior:

1. Validate integration credential.
2. Apply integration/IP rate limiting.
3. Bound and validate the request body.
4. Require an idempotency key.
5. Persist the Event.
6. Enqueue the Event into PGMQ in the same database transaction.
7. Return `202 Accepted`.

Conflicting reuse of an idempotency key is rejected rather than silently changing the stored Event.

The response is safe to retry.

## 4. Event → Moment

The worker normalizes publisher event types to registered Moment keys.

Example:

```
site.created
    ↓
site_created
```

When an active Moment matches:

```
Event
  ↓
Moment occurrence
```

The Event is marked processed.

When no active Moment matches, the Event is marked processed with a controlled `moment_not_registered` reason. Unknown publisher events therefore do not break the host SaaS.

A unique partial index prevents the same Event from creating multiple Moment occurrences.

## 5. PGMQ / worker

Queue:

```
runtime-events
```

The worker is implemented as a PostgreSQL function:

```
runtime_worker_tick(20, 60)
```

and scheduled with `pg_cron` every minute.

Processing model:

```
PGMQ read
  ↓
runtime_process_event
  ↓
delete queue message on success
```

Failed processing is not acknowledged, so the message can become visible again after the visibility timeout.

The previously added unused Edge Function worker was removed because there was no active deployment/scheduler path for it.

## 6. Decision → Delivery

`POST /v1/offer` is intentionally Moment-driven.

Request:

```json
{
  "moment_key": "invoice_created",
  "context": {
    "surface": "invoice_detail"
  }
}
```

The runtime:

1. Resolves the publisher integration.
2. Validates the Make Money capability.
3. Resolves the publisher's active Moment.
4. Finds an eligible advertiser Offer targeting that Moment.
5. Requires the advertiser workspace to have Reach Customers active and available capacity.
6. Creates a server-side Decision.
7. Creates an opaque Delivery token.
8. Returns raw JSON for publisher-native rendering.

A recent Moment occurrence is attached to the Decision when available, but missing asynchronous worker output does not create an artificial no-fill race.

No financial settlement occurs in Stage 9.

## 7. Cross-workspace offer targeting

The production network is two-sided.

Therefore:

```
Advertiser workspace
      ↓
Offer
      ↓
active Moment
      ↓
Publisher workspace
```

may cross workspace boundaries.

The old same-workspace `offer_moments` trigger was removed because it contradicted the network model.

Runtime decisioning still derives publisher identity from the integration and advertiser identity from server-side Offer state.

## 8. Delivery token

Stage 9 uses a server-issued opaque, high-entropy delivery token.

Only its SHA-256 hash is persisted.

The raw token is returned to the publisher once.

The token is not a client-supplied destination, price, qualification state, or financial value.

Click processing is intentionally not included yet.

## 9. Rate limiting

Rate limiting is part of the runtime boundary.

Current controls:

- invalid/missing integration credential: IP-scoped protection
- `/v1/track`: integration-scoped protection
- `/v1/offer`: integration-scoped protection

The limiter stores only hashed subjects in `private.rate_limit_buckets`.

The rate-limit function is:

- SECURITY DEFINER
- fixed `search_path`
- callable only by `service_role`

The runtime API returns `429` with `Retry-After` when the limit is exceeded.

Exact production limits remain operational tuning parameters, not product economics.

## 10. Security boundary

The following remain server-authoritative:

- integration identity
- product/workspace identity
- Moment resolution
- Offer selection
- destination URL
- financial values
- qualification state
- settlement state
- advertiser capacity

Private runtime tables are not directly granted to `anon` or `authenticated`.

Runtime RPC functions are explicitly executable only by `service_role`.

## 11. CI/CD and staging

### CI

`.github/workflows/ci.yml` runs on:

- pull requests targeting `master`
- pushes to `master`

Quality gate:

```
npm ci
npm run lint
npm run typecheck
npm run build
```

No Supabase service secret is passed into the ordinary CI job.

### Staging Gate

`.github/workflows/staging-gate.yml` is a manual staging gate using the GitHub `staging` environment.

Required secret:

```
STAGING_URL
```

Required staging checks:

- root page returns `200`
- `POST /v1/track` without credentials returns `401`
- `POST /v1/offer` without credentials returns `401`
- `OPTIONS /v1/track` returns `204`
- lint
- typecheck
- build

A live staging deployment must exist before this gate can be run successfully.

## 12. Verification

Live Supabase verification on 2026-09-26 confirmed:

- `pgmq` extension installed
- `pg_cron` extension installed
- `runtime-events` queue exists
- only `nextaction-runtime-worker` remains active after removing a duplicate worker schedule
- runtime RPCs are executable by `service_role` only
- `anon` and `authenticated` cannot execute the runtime RPCs
- final persistent runtime counts are zero for Events, Moment occurrences, Decisions, Deliveries, rate-limit buckets, Clicks, Qualified Clicks, and Settlements

Runtime smoke test was re-run against live Supabase with deterministic temporary fixtures and explicit cleanup. Results:

```
credential resolution   = ok
event first             = created
event replay            = same Event, not created again
conflicting replay      = rejected (23505)
queue after accept      = 1
worker tick             = 1 processed / 0 failed
event status            = processed
Moment occurrence       = 1
queue after worker      = 0
Decision / Delivery     = filled
rate limit              = allowed, allowed, rejected
```

All deterministic fixtures were deleted before commit; the pre-existing workspace/product/Moment data remained unchanged.

Temporary fixtures were explicitly deleted after verification; the pre-existing workspace/product/Moment data remained unchanged.

## 13. Known remaining gaps

Stage 9 does not implement:

- `GET /v1/click/:delivery_token`
- Click idempotency/economics
- Qualified Click rules/evidence
- Settlement execution and ledger mutation
- DNS-aware SSRF protection for a server-side URL scanner
- production Cloudflare deployment adapter
- automated deployment into a real staging environment

The Stage 9 runtime therefore establishes the first executable part of:

```
Event → Moment → Decision → Delivery
```

without prematurely mixing click qualification or financial settlement into the runtime ingress path.

## 14. Migration/source-of-truth note

GitHub contains the canonical Stage 9 SQL snapshots:

- `supabase/migrations/20260926030000_stage_9_runtime_core.sql`
- `supabase/migrations/20260926040000_stage_9_hardening.sql`
- `supabase/migrations/20260926044000_stage_9_runtime_surface_cleanup.sql`
- `supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql`

The live Supabase migration history also contains corrective entries created during implementation. The `20260926050000` GitHub snapshot records the atomic-upsert rate-limit implementation found in the already-corrected live database; it is a source-of-truth reconciliation marker and was not re-applied as duplicate live DDL. The recorded live Stage 9 sequence includes:

```
20260925214730  20260926030000_stage_9_runtime_core
20260925215138  stage_9_runtime_reconciliation
20260925215209  stage_9_runtime_reconciliation
20260925215210  stage_9_hardening
20260925215231  stage_9_runtime_hardening
20260925215322  stage_9_runtime_sql_fix
20260925215343  stage_9_runtime_builtin_fix
20260925215416  stage_9_decision_runtime_hardening
20260925215802  stage_9_runtime_surface_cleanup
```

Some corrective entries were produced while reconciling live state and cannot be reconstructed byte-for-byte from migration history alone through the connector. The committed Stage 9 snapshots describe the intended final source state; live production was verified separately.

## 15. Exit criteria

Stage 9 is ready to merge when:

- GitHub Actions must execute the quality job on an allocated runner and report green. Current attempts fail before runner steps execute (`runner_id=0`, `steps=[]`), so they do not establish an application lint/typecheck/build failure.
- runtime RPC privilege checks remain locked.
- transactional runtime smoke test remains green.
- staging gate is present and requires a real staging URL before claiming staging readiness.
- no Click/Qualified Click/Settlement semantics leak into Event ingestion.
- no client-supplied financial or tenant identity is trusted.

