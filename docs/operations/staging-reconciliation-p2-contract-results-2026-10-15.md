# P2 Disposable Behavioral Contract Results — updated 2026-10-16

## Result

**P2 disposable behavioral contract suite: PASS / COMPLETE** on code commit `0474cf11292d2af5c1b46293036d4790e5694a1f`.

- [Disposable Migration Replay — run 38883415296](https://github.com/fsoeltonione/nextaction/actions/runs/38883415296): PASS. Fresh disposable Supabase replay, Stage 17 historical pre-state checks, all SQL tests, and independent-session concurrency checks completed successfully.
- [Quality — run 38883415252](https://github.com/fsoeltonione/nextaction/actions/runs/38883415252): PASS, including Quality, Stage 16 activation, H2.3 release proof, runtime hardening, H3.1, release-boundary, Cloudflare compatibility and Cloudflare build.
- SQL contracts: **14 files / 238 pgTAP assertions**, all successful. The replay log reports `All tests successful`, `Files=14, Tests=238`, and `Result: PASS`.
- Migration history inside disposable replay: **53 applied entries in timestamp order** — 52 canonical migration files from the branch plus one runner-only Stage 14 baseline.
- [Staging Migration Dry-Run — read-only run 38883416081](https://github.com/fsoeltonione/nextaction/actions/runs/38883416081): fails closed at **0 paired / 52 local-only / 54 remote-only**. The log confirms no writes were executed. This is the separate D7 lineage blocker, not a P2 behavioral-test failure.
- PR [#141](https://github.com/fsoeltonione/nextaction/pull/141) remains open and Draft. The readiness migration and all tests remain branch/disposable-only.

## SQL contract inventory

| SQL test | Assertions | Verified scope |
|---|---:|---|
| `h3_network_moment_runtime_contract.sql` | 10 | Active Network Moment targeting fills; legacy product-scoped targeting remains a fallback when no network target is eligible; no eligible target yields `no_fill` without a Delivery. |
| `h4_settlement_capacity_idempotency_contract.sql` | 16 | `no_capacity` persists no settlement, ledger or consumption; capacity allows the $1 USD charge with 75/25 split; three balanced financial entries; replay does not duplicate Settlement, entries or consumption. |
| `h4_unsettled_settlement_recovery_contract.sql` | 10 | Recovery finds an eligible stale Qualified Click, settles it and records ledger/capacity effects once; settled clicks are skipped on subsequent runs. |
| `pgmq_service_role_usage_hardening.sql` | 4 | PGMQ schema-use/grant boundary. |
| `runtime_accept_event_contract.sql` | 12 | First Event and exact replay are idempotent; reuse of an idempotency key with changed payload, event type or `occurred_at` is rejected; malformed inputs fail closed. |
| `runtime_click_settlement_atomicity_contract.sql` | 7 | A composite `runtime_click_qualify_and_settle` call with unavailable financial accounts raises the expected failure and leaves no Click, Qualified Click, Settlement, financial entries or credit consumption; capacity remains available for retry. |
| `runtime_full_integrity_readiness_contract.sql` | 24 | A seeded fresh-success path produces `ready`; inactive, stale and failed worker/operations/integrity schedules produce `not_ready`; missing, stale, warning, critical or anomalous integrity snapshots also fail closed. |
| `runtime_rate_limit_scope_normalization.sql` | 3 | Rate-limit scope normalization behavior. |
| `runtime_resolver_contract.sql` | 13 | Malformed/unknown credentials; confirmed/proposed Product; inactive/missing `make_money`; revoked Integration and `revoked_at`; no secret disclosure; missing secret/Integration/Product dependencies fail closed; Product-to-Workspace FK remains validated with cascade semantics. |
| `runtime_rpc_contract.sql` | 78 | RPC existence, security-definer/search-path expectations and role grants; catalog/ACL evidence, not by itself full business-path proof. |
| `runtime_worker_quarantine_contract.sql` | 33 | Bounds; quarantine refresh without duplicate dead letters; malformed payload/invalid event ID path through actual worker; retry budget progression through the fifth `retry_exhausted` attempt; SQLSTATE/read count in dead letter; archive-failure recovery without partial occurrence writes or duplicate dead letters. |
| `stage16_activation_isolation_contract.sql` | 14 | `anon` denied; non-member/wrong-workspace activation rejected; missing/inactive Network Moment target and disabled capability rejected; malformed canonical URL, empty Moment list and non-HTTP Offer destination rejected. |
| `stage17_constraint_reconciliation_contract.sql` | 10 | Live validated settlement uniqueness and ready index; both disposable constraint-construction branches; duplicate rejection; current verifier uses `clicked_at`, not the nonexistent Click `created_at` column. |
| `uuid_default_resolution_contract.sql` | 4 | Qualified and unqualified UUID defaults resolve and return UUID values in disposable PostgreSQL; no hosted default normalization. |
| **Total** | **238** | **All 14 SQL contract files passed on the verified commit above.** |

## Additional disposable integration tests (not included in the 238 pgTAP count)

### Historical Stage 17 pre-state reproduction

The replay workflow ran `scripts/test-stage17-historical-prestate.sh` against a disposable database in two separate initial states:

1. A standalone unique index existed without the same-named constraint. Stage 17 attached the index to a validated unique constraint; a second Settlement for the same Qualified Click was rejected.
2. Neither the same-named index nor constraint existed. Stage 17 produced the validated unique constraint; duplicate settlement was rejected.

The script also reconstructed the historical verifier ordering variant that refers to `private.clicks.created_at`. Against the actual schema, that variant reproduced `undefined_column`; the current verifier uses the deployed `clicked_at` column. The workflow passed both historical pre-state variants. This is proof of effective behavior in disposable rehearsal; it does **not** identify the exact original full SQL blob for every historical staging row.

### Independent-session concurrency

The replay workflow also passed `scripts/test-disposable-runtime-concurrency.sh`:

- **Worker queue claim race:** two independent sessions attempted to process the same malformed queue message. Exactly one worker handled and archived it; the other did not claim it. One dead-letter record remained and the active queue row was gone.
- **Settlement race:** simultaneous settlement calls returned `settled` and `replayed`; exactly one Settlement, three financial ledger entries, one credit-consumption entry and zero remaining capacity resulted.
- **First-workspace bootstrap race:** two independent authenticated sessions confirmed the same first Product concurrently. Exactly one Workspace, one Product and one Moment were persisted for the test user.

All IDs, trigger delays and effects above are disposable CI fixtures. They were not run against staging or production.

## D10 readiness candidate

The forward-only candidate migration `supabase/migrations/20261015120000_runtime_full_integrity_readiness.sql` remains in the branch. The `runtime_readiness()` contract now includes the integrity-audit schedule, recent successful run and latest fresh zero-anomaly `ok` snapshot alongside worker/operations health. CI proves behavior on replay only; this migration has **not** been applied to hosted staging or production.

## Exit assessment and remaining non-P2 gates

P2's agreed disposable behavioral contracts are complete for the cases listed above. That does not mean the overall reconciliation is ready to execute:

- **D7 is still OPEN and blocking.** Current staging CLI result remains 0 paired, 52 local-only and 54 remote-only. Preserve all hosted history rows. Do not run `supabase migration repair`, non-dry-run `supabase db push`, direct DML against `supabase_migrations.schema_migrations`, or merge PR #141 while this gate is open.
- **D4/D5 source attribution remains partial.** The effective constraint branches and old/new verifier behavior are now exercised in disposable pre-state runs, but the complete original historical source payloads/source commits remain unbound. Do not convert behavioral proof into a claim of byte-level historical provenance.
- **H2.1 full-file source identity and other explicitly documented historical payload exceptions remain provenance issues.** P2 success does not retroactively rewrite or pair remote version keys with local migration filenames.
- **No hosted database schema, function, policy, grant, index, business row or migration history was changed.** PR #141 remains open and Draft; P3 convergence/any go-no-go requires a separately reviewed, source-backed decision after D7 is resolved.

## Previous snapshot

The 194-assertion / 13-file count recorded on 2026-10-15 was an earlier P2 snapshot and is superseded by the current-head result above. Earlier point-in-time status notes are retained in the final plan and decision matrix for audit chronology.
