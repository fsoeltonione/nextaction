# P2 Disposable Behavioral Contract Results — 2026-10-15

## Result and safety boundary

**Result: the disposable migration replay passed 194 pgTAP assertions across 13 SQL test files. P2 is substantially advanced, but is not fully closed.**

- Repository/PR: [fsoeltonione/nextaction PR #141](https://github.com/fsoeltonione/nextaction/pull/141), branch `audit/staging-migration-lineage-20261014`.
- Tested source commit: `c52478936d82d90fba07b994a46bbf80b02e4de7`.
- Disposable replay: [workflow run 38637990437](https://github.com/fsoeltonione/nextaction/actions/runs/38637990437), job `116105978075`. Log result: `Files=13, Tests=194`, `All tests successful`, `Result: PASS`.
- At the last status read, Quality run [38637990582](https://github.com/fsoeltonione/nextaction/actions/runs/38637990582) had passed core Quality, Stage 16, H3.1, H2.3, runtime-hardening and release-boundary checks, plus Cloudflare compatibility; Cloudflare build was still in progress. Re-check the workflow before marking the full Quality workflow complete.
- The staging-only CLI gate [run 38637990404](https://github.com/fsoeltonione/nextaction/actions/runs/38637990404) remains failed by its deliberate sync assertion: **0 paired, 52 local-only, 54 remote-only (106 unpaired)**. The workflow ran read-only `migration list` and `db push --dry-run`; it explicitly reports that no writes were executed.
- No direct SQL write, schema change, migration-history repair, or migration push was made to hosted staging or production. The added migration and test fixtures are only in the GitHub branch; test fixtures are wrapped in rollback transactions.
- PR #141 remains **open and Draft**. D7 remains an open blocker; no merge or hosted execution is authorized by these test results.

## Tested contracts

All 13 files passed in the disposable replay:

| SQL test file | Assertions | Coverage demonstrated |
|---|---:|---|
| `runtime_resolver_contract.sql` | 8 | Malformed/unknown credentials, confirmed vs proposed product, make_money capability disabled, revoked integration and revoked timestamp, no credential hash/secret in the resolver result. This is a focused state matrix, not yet every missing-row edge case. |
| `runtime_accept_event_contract.sql` | 12 | Event acceptance and exact idempotent replay; rejects changed payload, event type and occurred-at timestamp under the same idempotency key; validates malformed/missing input paths. |
| `runtime_rpc_contract.sql` | 78 | Presence, SECURITY DEFINER, pinned search path and role grants for the listed runtime RPCs. These are catalog/ACL checks, not full business-path proofs for every RPC. |
| `pgmq_service_role_usage_hardening.sql` | 4 | PGMQ service-role usage hardening assertions. |
| `runtime_rate_limit_scope_normalization.sql` | 3 | Rate-limit scope normalization assertions. |
| `runtime_worker_quarantine_contract.sql` | 21 | Worker and operations argument bounds; quarantine upsert refreshes metadata/last-seen without duplicate dead-letter rows; actual worker RPC quarantines and archives non-object payload and invalid event ID messages. |
| `runtime_full_integrity_readiness_contract.sql` | 9 | Readiness definition requires worker, operations and integrity-audit scheduling plus a fresh zero-anomaly snapshot; output exposes each readiness component. |
| `stage16_activation_isolation_contract.sql` | 11 | Authenticated caller cannot activate or create against a non-member workspace; anon execution is denied; unavailable network target and disabled capability are rejected. |
| `stage17_constraint_reconciliation_contract.sql` | 8 | Current settlements table has a validated unique Qualified Click constraint and valid/ready unique index; disposable probes verify both index-attachment and direct UNIQUE(column) semantics. |
| `h3_network_moment_runtime_contract.sql` | 10 | Active Network Moment targeting creates a fill, legacy product-scoped targeting remains the fallback when the network path has no eligible target, and no eligible target yields a no-fill with no delivery. |
| `h4_settlement_capacity_idempotency_contract.sql` | 16 | Zero capacity returns retryable `no_capacity` without settlement/ledger/credit consumption; capacity permits the $1 / 75–25 split; exactly three balanced financial entries are recorded; repeat settlement returns `replayed` and does not duplicate charges or ledger rows. |
| `h4_unsettled_settlement_recovery_contract.sql` | 10 | Bounded recovery selects one stale eligible Qualified Click, settles it, records three ledger entries, consumes one unit, and skips the already-settled click on a subsequent pass. |
| `uuid_default_resolution_contract.sql` | 4 | Schema-qualified and unqualified UUID default expressions both resolve to UUID-producing functions in disposable PostgreSQL. This does not authorize normalization of hosted defaults. |

## D10 full-integrity readiness implementation

Added [`20261015120000_runtime_full_integrity_readiness.sql`](https://github.com/fsoeltonione/nextaction/blob/audit/staging-migration-lineage-20261014/supabase/migrations/20261015120000_runtime_full_integrity_readiness.sql) in the branch. `runtime_readiness()` now requires:
1. runtime queue and worker function exist;
2. worker schedule active with a recent successful run;
3. operations schedule active with a recent successful run;
4. integrity-audit schedule active with a recent successful run; and
5. the latest integrity snapshot is fresh (10 minutes), `status = 'ok'`, and `anomaly_count = 0`.

The migration was applied only by the disposable local replay. It has **not** been pushed to staging or production. The current readiness contract checks the blocking conditions and output shape; a positive-path test proving `ready` with deliberately seeded fresh cron history and snapshot is still outstanding.

## Remaining P2 gaps — keep OPEN

1. **Worker retry / failure containment:** the actual malformed-message path and dead-letter upsert are covered. Retry progression through the retry budget, retry exhaustion by the actual worker, archive failure recovery, and concurrent worker claims are not yet demonstrated end-to-end.
2. **D4/D5 verifier and historical constraint behavior:** the current unique settlement invariant and two generic disposable constraint branches pass. The tests do not yet replay each historical Stage 17 pre-state and prove the old `created_at` verifier variant versus current `clicked_at` behavior, or prove the migration branch against an actual historical index/constraint arrangement. D4/D5 therefore remain **OPEN**.
3. **Financial atomicity and concurrency:** direct settlement no-capacity, success, replay, and H4.1 recovery are tested. Concurrent settlement races, the composite `runtime_click_qualify_and_settle` rollback contract when the financial system is unavailable, and duplicate/no-double-debit behavior under simultaneous callers remain unproven.
4. **Resolver and activation edge coverage:** add missing secret row, integration/product/workspace missing or inconsistent cases, capability row absent vs disabled, concurrent activation/workspace creation and broader negative-input boundaries where relevant.
5. **Readiness positive path:** prove the RPC returns `ready` only when each scheduler has recent successful history and the latest zero-anomaly snapshot is fresh; prove stale, critical and missing snapshots each produce `not_ready`.
6. **D7 CLI lineage blocker:** this is independent of behavioral-test success. Do not use `migration repair`, non-dry-run `db push`, or direct edits to hosted `supabase_migrations.schema_migrations` to make the gate pass. Continue source-backed pairing; preserve HOLD while any remote version remains unpaired.

## Next step

Continue P2 as a bounded disposable-only workstream for the remaining worker retry/concurrency, historical verifier behavior, financial atomicity/concurrency and readiness positive-path proofs. After each batch, rerun the disposable migration replay and current-head Quality. Only then update the decision matrix and final plan to distinguish each demonstrated contract from residual uncertainty.

**Final safety decision: HOLD — NO HOSTED DATABASE WRITES.**
