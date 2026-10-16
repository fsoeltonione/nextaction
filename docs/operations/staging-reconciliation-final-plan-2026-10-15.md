# Final Staging Migration Reconciliation Plan & Disposition Register — 2026-10-15

## 1. Decision and safety boundary

**Decision: HOLD — NO DATABASE WRITES.** The user has approved all D1–D12 dispositions and the phased plan; that approval is not execution authorization.

- In scope for eventual reconciliation: staging project `njjybpswxalxjhqjlvqa` only.
- Explicitly out of scope: production project `khoygjyikxkdwonygzyh`. No production writes or migration actions are authorized by this document.
- Prohibited while HOLD remains: `supabase db push` without `--dry-run`, `supabase migration repair`, direct DML/DDL against `supabase_migrations.schema_migrations`, replaying legacy fixture SQL against hosted staging, and applying any proposed function/catalog normalization.
- The migration manifest and earlier decision matrix are the detailed evidence sources. This document makes their open decisions explicit; it does not upgrade partial/effect-only evidence into exact source provenance.

A user acceptance of an unresolved evidence gap may authorize documenting that limitation as an audit exception. It does **not** make the CLI gate pass and does **not** authorize any database write.

## 2. Evidence snapshot — current branch/test evidence as of 2026-10-16

Repository: [fsoeltonione/nextaction](https://github.com/fsoeltonione/nextaction), PR [#141](https://github.com/fsoeltonione/nextaction/pull/141), branch `audit/staging-migration-lineage-20261014`. PR remains **open and Draft**.

- The completed P1 lineage inventory is a frozen evidence snapshot of 54 staging history rows, 54 production history rows and 51 canonical local migration files. The current branch now contains **52 local migration files** because P2 added the proposed forward-only migration `20261015120000_runtime_full_integrity_readiness.sql`. That new P2 migration did not exist in the P1 snapshot and is deliberately not claimed as mapped to hosted staging history.
- The P1 read-only query verified staging `supabase_migrations.schema_migrations` version, name, stored SQL length and MD5 fingerprints against the manifest: **54/54 staging history rows matched the recorded manifest fingerprints**. This proves the snapshot is recorded consistently; it does not make current local and remote version keys synchronized.
- Historical source comparisons remain classified as before: 27/54 staging rows had exact current source payload matches, 3 exact historical revisions, 19 executable-body matches with explicit source limitations, 1 token-sequence match, 3 partial/superseded rows (D1/D4/D5) and 1 fixture effect-only row (D2). Strict source mismatch is not proof that a migration was unapplied.
- Latest staging-only CLI gate [run 38883416081](https://github.com/fsoeltonione/nextaction/actions/runs/38883416081) on code commit `0474cf11292d2af5c1b46293036d4790e5694a1f` ran the read-only migration list and `supabase db push --dry-run`, then failed its synchronization assertion: **0 paired, 52 local-only, 54 remote-only (106 unpaired)**. Logs say **no writes were executed**. D7 remains an open blocker.
- Latest completed disposable replay [run 38883415296](https://github.com/fsoeltonione/nextaction/actions/runs/38883415296) passed **14 SQL test files / 238 pgTAP assertions** from a fresh disposable database. The same run passed both Stage 17 historical pre-state branches and the independent-session worker, settlement and first-workspace bootstrap races; log says `All tests successful` and `Result: PASS`.
- Latest completed Quality workflow [run 38883415252](https://github.com/fsoeltonione/nextaction/actions/runs/38883415252) passed, including core Quality, Stage 16, H3.1, H2.3 release proof, runtime hardening, release boundary, Cloudflare compatibility and Cloudflare build.
- P2 closure evidence is recorded in [P2 Disposable Behavioral Contract Results — updated 2026-10-16](staging-reconciliation-p2-contract-results-2026-10-15.md). The agreed disposable behavioral matrix is **COMPLETE: 14 SQL files / 238 pgTAP assertions plus historical Stage 17 pre-state and independent-session race scripts pass**. D4/D5 complete the effective-behavior tests but retain source-attribution limitations; D7 remains separately open.
- No hosted staging or production schema, function, grant, RLS policy, business row, index, or migration-history row was changed. New migration SQL and test fixtures exist in the GitHub branch only; disposable SQL tests wrap fixture changes in rollback transactions.

## 3. Disposition register — approved 2026-10-15

The user approved all D1–D12 dispositions in this register on 2026-10-15. This approval accepts each documented classification/status and the proposed treatment; it does **not** certify missing source artifacts as found, close the behavior tests designated OPEN, waive the CLI blocker, or authorize database writes. The execution gate remains separate.

| ID | Gap / verified evidence | **Approved disposition (2026-10-15)** | Scope / limitation of approval |
|---|---|---|---|
| **D1** | Stage 14 bootstrap, staging row `20260926122918`: stored body matches the four table-creation statements in the later expanded sidecar, but the original pre-sidecar source blob is unbound. The sidecar also contains an auth fixture statement absent from this payload. | **APPROVED — legacy staging-only bootstrap with partial/superseded source provenance; preserve the remote row and do not replay it.** Retain the source limitation in the ledger. | Accepts a permanent or until-found source-blob limitation; does not assert that the sidecar was the original applied artifact. |
| **D2** | Stage 14 credit fixture, row `20260926215632`: the 263-character UPDATE of the Stage 14 Advertiser credit account is absent from checked-in seed revisions. A later seed change corroborates intended fixture capacity but not the exact SQL source. | **APPROVED — historical fixture normalization, not a canonical product migration; preserve the row and never rerun it on hosted staging.** | Accepts incomplete source identity for a test-fixture mutation only. It cannot be reused against another workspace/environment. |
| **D3** | Stage 9 rate-limit reconciliation, row `20260926123146`: executable body matches the Stage 14 sidecar after removing comments/transaction wrappers; exact source artifact at application time is unbound. Later scope-normalization migration corroborates current behavior. | **APPROVED — executable-body match plus an open original-source attribution note; retain history unchanged and use the later forward correction as current-behavior evidence.** | Does not claim exact whole-file provenance and does not authorize a history rewrite. |
| **D4** | Stage 17 second remediation, row `20261003154220`: some blocks match current source, but constraint-guard logic differs and its verifier used `created_at` rather than `clicked_at`. The subsequent verifier-fix row maps exactly to its source. The 2026-10-16 disposable historical pre-state script now reproduces the old verifier failure and verifies effective constraint behavior. | **APPROVED — KEEP OPEN for whole-payload historical source attribution.** The named disposable behavior comparison is now complete. Preserve the applied row; do not replay or replace it. | This is a financial/settlement control. Passing disposable behavior proves the tested effective branches, not which full historical SQL blob ran on staging. |
| **D5** | Stage 17 final reconcile, row `20261003154641`: remaining executable body matches after excluding a differing constraint block; current logic uses an existing unique index with `UNIQUE USING INDEX`. The 2026-10-16 replay passed both index-only and no-index pre-state branches and duplicate-settlement rejection. | **APPROVED — KEEP OPEN for whole-payload historical source attribution.** Effective constraint behavior comparison is complete in disposable replay. Preserve the remote row and current business-uniqueness objects. | The historical constraint DDL is not asserted interchangeable; no hosted index/constraint DDL is authorized. |
| **D6** | H2.1, staging row `20261003175300`: normalized executable body and active worker behavior match after omitting the source candidate's unused `v_attempts INTEGER` declaration, but exact whole-file source blob is unbound. | **APPROVED — accept executable-body match as effect evidence; retain original-blob identity as an explicit audit exception if further Git-history recovery finds nothing. No replay or history edit.** | Closes no more than the provenance classification. Retry exhaustion, quarantine, archive-failure and concurrent-worker tests remain separate gates. |
| **D7** | CLI sync gate: zero paired versions, 51 local-only, 54 remote-only on latest checked run. | **APPROVED — KEEP OPEN BLOCKER; do not waive as a pass.** The release/reconciliation plan stops before execution until evidence-backed pairing is resolved. An explicit decision to accept this blocker means **remain in no-write mode and keep PR #141 Draft**. | This is the critical gate. Accepting “blocker remains open” is not an exception that permits `db push`, `migration repair`, merge, or production action. |
| **D8** | Six function fingerprint differences remain a historical cross-environment/source-evidence distinction. Current disposable contracts now exercise Event acceptance (12), worker quarantine/retry/archive recovery (33), full-integrity readiness (24) and resolver edge cases (13). | **KEEP OPEN for exact staging/production semantic equivalence and untested paths; the named P2 local behavior matrix passes.** Do not replace live functions just to make hashes equal. | P2 does not certify byte-level source identity or claim all differences are semantically equivalent across hosted environments. |
| **D9** | Activation v2/private-helper authorization paths are covered by the passing disposable role-based suite: anon denial, wrong-workspace/non-member, missing/inactive network target, disabled capability and malformed product/offer inputs; first-workspace concurrency is additionally exercised cross-session. | **P2 test gap CLOSED for the named matrix; do not infer a vulnerability from grants alone.** Broader cross-environment equivalence remains outside this disposable test result. | Coverage refers to the listed paths and synthetic identities only; no hosted helper/function was changed. |
| **D10** | The branch-only forward migration `20261015120000_runtime_full_integrity_readiness.sql` extends `runtime_readiness()` to require recent worker, operations and integrity-audit success plus a fresh zero-anomaly snapshot; its 24-assertion disposable contract passes healthy and fail-closed states. | **P2 test and candidate contract COMPLETE in branch/disposable scope.** The migration has not been applied to hosted staging or production. | Readiness implementation/evidence remains candidate-only; this does not change D7. |
| **D11** | Four staging UUID defaults use `extensions.gen_random_uuid()`; previous cross-environment inspection recorded unqualified `gen_random_uuid()` in production. | **APPROVED PROVISIONALLY — likely schema-qualification-only difference; retain both forms until disposable resolution tests confirm equivalent UUID generation and extension binding.** | Does not authorize normalizing defaults or treating different catalog text as a migration blocker by itself. |
| **D12** | Worker retry exhaustion/archive recovery/claim race; H3 active/fallback/no-fill; H4 capacity/recovery/replay; composite financial rollback; and simultaneous settlement with no duplicate ledger/debit are now exercised by passing disposable SQL/cross-session tests. | **P2 behavioral regression gate CLOSED for the explicit matrix above.** Preserve residual provenance and D7 gates; no production financial event was created. | Passing tests do not replace hosted history pairing or authorize settlement tests on staging/production. |

### Approval record

**User approval received:** all D1–D12 accepted as listed on 2026-10-15. The 2026-10-16 P2 result below updates completion of the previously open disposable test work; it does not waive D7 or authorize hosted execution.

- D1–D3 and D6: approved classifications/audit exceptions with no hosted replay.
- D4–D5: the named disposable historical constraint/verifier behavior tests now pass; exact historical source attribution remains OPEN. D8–D9 and D12 must be read together with the 2026-10-16 P2 closure evidence: the listed disposable regression matrix passes, but P2 does not certify byte-level equivalence of staging/production function history or clear D7.
- D7: approved to remain an OPEN CLI blocker; **NO WRITES and PR remains Draft** while it is open.
- D10: approved **FULL-INTEGRITY** as the intended readiness contract; implementing it requires tests and a separate reviewed code-change proposal.
- D11: approved provisionally; no catalog normalization authorized.

The approval applies to dispositions and the plan only. It is not permission to run CLI repair, modify migration history, apply SQL to hosted staging, or touch production.

## 4. Conditional execution plan — only after dispositions and a separate approval

### Phase A — freeze and preserve evidence (no writes)

1. Keep PR #141 Draft and preserve the reviewed branch; documentation and isolated tests may proceed, but no production merge/deploy or hosted database change is authorized.
2. Do not rename, delete, duplicate, or reorder canonical migration files to silence the CLI. Do not place archival remote payload copies in the active `supabase/migrations` directory: the CLI could interpret them as migrations to apply.
3. Keep the per-row manifest as the source of truth. For every remote staging row, maintain: remote version/name; exact stored payload hash/length; source repository path, commit and blob SHA (or explicit unbound classification); behavioral effect; dependency/order; evidence category; chosen disposition; replay risk; acceptance proof.
4. Production remains excluded. Its existing manifest rows are evidence only; production history is not to be repaired as a side effect of staging work.

### Phase B — close or accept provenance rows (no writes)

1. Search for additional source evidence for D1–D6 in Git history and archived sidecar/release evidence; D1–D3 and D6 exceptions are already accepted, so new evidence should refine the record rather than silently change the disposition.
2. If an original file/blob remains unavailable, retain it as unbound and preserve the approved audit exception for D1–D3/D6. Do not manufacture provenance.
3. For D4 and D5, prove effective unique constraint/index and verifier semantics through disposable migrations/contracts; their source/behavior classification remains OPEN until that evidence is accepted.
4. Keep any gap open if payload differences may change settlement/authorization semantics. A live catalog snapshot can establish present state; it cannot prove which historical file caused it.

### Phase C — close functional contracts in disposable replay

1. Expand resolver/acceptance tests: active, revoked/inactive, invalid credential, unconfirmed product, missing/inactive `make_money`, malformed inputs, exact replay, changed payload/event type/timestamp, and no credential/hash leakage.
2. Expand worker/quarantine tests: bounded arguments, retry progression and exhaustion, poison messages, dead-letter upsert metadata/timestamp, queue archive success/failure, missing queue-message path, and concurrent-worker claim safety.
3. Test readiness semantics: missing/inactive/stale worker, operations and integrity-audit scheduler; queue missing/non-empty; latest integrity snapshot missing/stale; and the approved intended meaning of “ready.”
4. Test Stage 16 activation under `authenticated` and `anon`: concurrent first-workspace bootstrap, wrong workspace/non-member, missing capability, malformed input, and helper EXECUTE not bypassing authorization.
5. Test H3/H4/financial behavior: invalid or inactive network mapping rejected, `no_capacity` retryable, recovery bounded, stable settlement identity, and no duplicate debit/credit/ledger row under replay and concurrency.
6. Rerun all existing SQL contracts and the entire Quality workflow. Record the exact commit and successful job URLs. Passing disposable replay does not close D7.

### Phase D — formulate the migration-history reconciliation mechanism (design only)

1. Produce a **54-row staging version mapping**. Every applied staging version must be matched to a historical SQL payload/source artifact or have an explicit accepted exception. Categorize every row as canonical exact, historical alias exact, executable-body match, partial/superseded, fixture-only, marker-only, or unbound.
2. Separately enumerate all 51 local migrations as: proven represented by a particular staging payload/effect; required but not demonstrably represented; or duplicate/unsafe to apply to the existing staging state. Do not infer “unapplied” solely from absence of byte equality.
3. For each proposed change to migration history, specify exact version(s), intended CLI state transition, evidence proving the schema effects already exist or are not present, blast radius, stop condition, and recovery method. History repair changes history metadata, not the corresponding schema objects; it must never substitute for schema-effect proof.
4. Compare alternative strategies in a reviewable document before choosing one: retain the mismatch and remain no-write; or propose a bounded, staging-only CLI-supported history reconciliation after exact row mapping. No strategy is approved by this plan. Do not directly update `supabase_migrations.schema_migrations`.
5. Treat any action that would make the CLI pass by merely suppressing remote-only rows or marking local migrations applied without row-by-row effect proof as **rejected**.

### Phase E — backups, rehearsal and final go/no-go (not authorized yet)

1. Before a future staging write is considered, document the recovery point, available backup/PITR method, exact restore steps, restore permissions, and how restore success will be verified. A backup plan is incomplete until restoration is rehearsed where safe.
2. Run proposed history changes in an isolated clone/disposable database first. Verify complete canonical replay from empty, expected migration order, function/catalog contracts, RLS and grants, financial uniqueness, scheduler health, and rollback/restore.
3. Re-run read-only staging history list and dry-run from the pinned staging-only target. To clear D7, require an evidence-backed, reviewed result with a fully explained mapping, no unexpected SQL proposed, and the intended postcondition explicitly stated. If the CLI still reports unpaired versions, stop and retain HOLD.
4. Publish a bounded change plan listing exact versions/commands, one action per checkpoint, expected outputs, abort criteria and recovery steps. Obtain separate explicit approval before any staging mutation.
5. Independently review whether PR #141's canonical migration files should be merged. Do not merge it merely because Quality or disposable replay passes; current PR remains Draft until its review criteria and the CLI decision are addressed.
6. No production operation is part of this workflow. A separate future task with its own evidence and approval would be required for production.

## 5. Go/no-go conditions

**GO to a separately approved staging execution plan only if all apply:**

- User dispositions are recorded for D1–D12 and none hides a high-impact authorization/financial gap.
- The staging migration-version map is complete, with explicitly accepted source exceptions distinguished from unresolved effects.
- D4/D5 financial constraint behavior and all required runtime/tenant-isolation regression gates pass in disposable environments.
- The chosen CLI reconciliation strategy has a reviewed row-by-row effect proof and a rehearsed recovery plan.
- Staging-only target is pinned and verified; no production credentials/target can be selected accidentally.
- The exact execution plan is separately approved.

**NO-GO / HOLD if any apply:**

- Any unexplained duplicate, missing effect, settlement uniqueness discrepancy, tenant-boundary failure, or non-deterministic replay remains.
- CLI history is still unpaired without explicit evidence-backed treatment.
- The CLI blocker is accepted as remaining open. That decision explicitly means no writes and PR stays Draft.
- Backup/restore or abort criteria are not demonstrated.
- Anyone proposes production work as part of the staging task.

## 6. Final state

**HOLD — NO DATABASE WRITES.** D1–D12 dispositions are approved; P1 inventory/classification is complete. No hosted history reconciliation, schema/data mutation, migration repair, function replacement, PR merge or production action has occurred or is authorized.

Related evidence:
- [P1 mapping register — 54 staging rows / 51 local SQL files](staging-reconciliation-p1-mapping-2026-10-15.md)
- [PR #141](https://github.com/fsoeltonione/nextaction/pull/141)
- [Migration manifest](https://github.com/fsoeltonione/nextaction/blob/audit/staging-migration-lineage-20261014/docs/operations/staging-production-migration-manifest-2026-10-14.md)
- [Decision matrix](https://github.com/fsoeltonione/nextaction/blob/audit/staging-migration-lineage-20261014/docs/operations/staging-reconciliation-decision-matrix-2026-10-14.md)
- [Latest disposable replay](https://github.com/fsoeltonione/nextaction/actions/runs/38613116566)
- [Latest Quality workflow](https://github.com/fsoeltonione/nextaction/actions/runs/38613116762)
- [Latest failed staging CLI gate](https://github.com/fsoeltonione/nextaction/actions/runs/38613116804)


## 7. Approved disposition outcome and phased execution roadmap

### Approval boundary

The D1–D12 dispositions are **APPROVED**, as recorded above. The plan is approved for planning, read-only investigation, disposable tests and rehearsal work. **Hosted database execution is not approved.** D7 remains an open blocker by approval, so every phase before a separate go/no-go is read-only or disposable-only.

### Phase gate summary

| Phase | Purpose | Allowed environment/actions | Status after this approval | Exit gate |
|---|---|---|---|---|
| **P0 — Record decisions and freeze** | Record D1–D12, define safety boundary, refresh links/status | Repository documentation only | **Complete** | Approved dispositions appear consistently in plan, matrix and PR text; no database writes |
| **P1 — Complete staging row/effect map** | Reconcile all 54 staging rows to source/effect/exception and all 51 local migrations to their representation status | GitHub source/history artifacts and read-only staging queries only | **COMPLETE — inventory/classification** | Every staging row classified; D4/D5 differences described; every local migration categorized; no inferred “unapplied” status from hash mismatch alone |
| **P2 — Close disposable behavioral contracts** | Test effective financial, runtime, readiness, network and workspace boundaries | Isolated local/disposable Supabase only; synthetic IDs/data; rollback-contained tests | **COMPLETE — 14 files / 238 assertions pass; historical pre-state and cross-session race scripts pass** | Agreed disposable behavior matrix is exercised from a fresh replay; preserve limits on exact historical source attribution; no hosted project is the test target |
| **P3 — Design CLI/history convergence** | Select and prove a version-history strategy for the 0/51/54 mismatch | Source analysis, current CLI help, docs review, disposable rehearsal; no hosted repair | **Blocked on P1/P2 evidence** | Row-by-row action map exists; each metadata transition has effect proof, order, stop and recovery conditions; disposable rehearsal yields the intended state |
| **P4 — Backup/restore readiness** | Establish recovery before any potential hosted staging change | Read-only check of actual backup availability; rehearsal in disposable environment; no staging mutation | **Not started** | Backup/PITR availability and retention verified, not assumed; exact recovery steps and access documented; restore rehearsed and independently verified |
| **P5 — Staging go/no-go preflight** | Revalidate target, source head, live history/catalog and expected CLI result | Read-only staging commands/queries only | **Blocked while D7 remains open** | Exact target verified; no production target selectable; current before-state fingerprint captured; CLI gate resolved and dry-run no-op or its reviewed output expressly expected |
| **P6 — Bounded staging change window** | Apply only a separately approved history reconciliation mechanism | **Not authorized now.** Potentially staging only, after separate explicit approval | **NO-GO / HOLD** | Exact commands/versions approved; one bounded metadata change at a time; immediate read-only validation; stop conditions and recovery ready |
| **P7 — Post-change verification and closeout** | Prove history, schema, authorization, financial invariants and operations after any future approved change | Read-only staging verification and disposable regression suite | **Not authorized until P6 separately approved and completed** | Expected history map matches; dry-run has no unexpected SQL; catalog/security/financial/runtime checks pass; residual risks recorded |

### P1 — Complete the 54-row staging / 51-file local map — COMPLETE (2026-10-15)

P1 deliverable: [P1 mapping register — all 54 staging rows and 51 current local files](staging-reconciliation-p1-mapping-2026-10-15.md).

1. **Inventory/fingerprint verification complete:** a fresh staging read-only SELECT confirmed every remote row's version, name, stored SQL-character count and MD5 matched the prior manifest, **54/54**. No migration SQL was replayed and no hosted write ran.
2. The 54 rows are classified as 27 exact current-source payloads, 3 exact historical source revisions, 19 executable-body matches (including explicitly qualified source exceptions), 1 token-sequence match, 3 partial/superseded rows (D1/D4/D5), and 1 fixture-effect-only row (D2). The classes are not interchangeable evidence strengths.
3. All 51 local SQL files have a candidate staging row and a representation-state label: 27 direct current-file payload matches, 3 historic source revisions, 18 normalized executable-body mappings, 1 token-sequence mapping, 1 partial Stage 17 final-reconcile mapping, and 1 H2.1 body-match/source-blob exception. This is not a claim that each current file is the exact deployed revision or safe to replay.
4. Current source/effect questions remain explicit: D4/D5 constraint/verifier differences, H2.1 original full-file blob identity, and the H2.3 current-source required-migration guard not demonstrated by the historic payload. These do not imply an effect is absent; prove the effective behavior before any future history decision.
5. Preserve approved exceptions D1–D3/D6. P2 behavioral proofs for D4/D5 now pass in disposable historical pre-states, but exact full-payload/source-commit attribution remains open; keep those provenance notes and original remote rows unchanged. Fixture/smoke/marker history stays distinguished from canonical schema migrations. Production remains out of scope.
6. **P1 exit gate satisfied for inventory/classification only.** No staging row or local file remains unclassified. D4/D5 behavior, current-source deltas and D7 remain open for their own gates.

### P2 — Disposable-only behavioral test work — COMPLETE (2026-10-16)

**Exit result:** [Disposable Migration Replay run 38883415296](https://github.com/fsoeltonione/nextaction/actions/runs/38883415296) passed 14 SQL files / **238 pgTAP assertions**, all Stage 17 historical pre-state variants, and independent-session race checks at code commit `0474cf11292d2af5c1b46293036d4790e5694a1f`. [Quality run 38883415252](https://github.com/fsoeltonione/nextaction/actions/runs/38883415252) also passed all jobs. Full contract inventory is in [P2 Disposable Behavioral Contract Results — updated 2026-10-16](staging-reconciliation-p2-contract-results-2026-10-15.md).

Completed evidence includes:

- **Resolver and Event ingestion:** 13 resolver assertions cover invalid/missing/revoked dependencies and capability/product readiness; 12 Event acceptance tests cover stable idempotency and changed-payload/type/timestamp conflicts.
- **Worker operations:** 33 worker/quarantine assertions cover bounds, actual malformed-message handling, retry progression and retry exhaustion on the fifth attempt, durable dead-letter data, archive-failure recovery and no duplicate dead letters/partial Moment Occurrences.
- **Full-integrity readiness (D10):** 24 assertions seed recent successful worker/operations/integrity jobs plus a fresh zero-anomaly snapshot and require `ready`; inactive, missing/stale/failed jobs and stale/missing/warning/critical/anomalous snapshots fail closed.
- **Activation/tenant boundary (D9 matrix):** authenticated non-member and wrong-workspace calls fail; anon is denied; missing/inactive Network Moment and disabled capability paths fail closed; malformed canonical URL, empty Moments and non-HTTP destination inputs are rejected.
- **Stage 17 D4/D5 behavior:** the disposable historical runner applies Stage 17 from index-only and no-index pre-states, validates the named unique constraint, rejects duplicate settlement and reproduces the old verifier's `created_at` undefined-column failure versus current `clicked_at`.
- **Financial atomicity and concurrency:** a `financial_unavailable` composite click/settle outcome rolls back the Click, Qualified Click, Settlement, ledger and credit-consumption writes while preserving capacity. Two independent sessions racing to settle the same click produce one `settled`, one `replayed`, one Settlement, three ledger entries, one capacity consumption and zero remaining capacity.
- **Queue and bootstrap races:** two independent worker sessions do not double-claim the same queue message; concurrent first-workspace activation persists exactly one Workspace/Product/Moment.
- **H3/H4 and financial contracts:** active Network Moment, legacy fallback, no-fill, `no_capacity`, $1/75–25 split, three balanced ledger entries, replay idempotency and bounded stale-settlement recovery pass.
- **Catalog and defaults:** the 78-assertion RPC security/catalog contract, PGMQ schema-use hardening and qualified/unqualified UUID default behavior pass.

The forward-only candidate migration `20261015120000_runtime_full_integrity_readiness.sql` and test changes are committed to this branch only. No hosted database was used to test or apply them.

**P2 is complete for the agreed disposable behavioral matrix.** This is not a claim that all historical SQL files have byte-level provenance or that the hosted environments are interchangeable. D4/D5 effective behavior is now tested, while their exact original source attribution remains an open audit note. P3 remains blocked by D7: current staging CLI reports **0 paired / 52 local-only / 54 remote-only** and explicitly records no writes. Keep PR #141 open and Draft; no migration repair, non-dry-run push, hosted history mutation or production action is authorized.

### P3 — CLI history strategy, proven before staging

Current Supabase documentation describes db push --dry-run as a preview and migration repair as metadata-only history repair. Marking a version applied inserts a history record; marking it reverted deletes one. Because metadata does not apply/revert the underlying schema SQL, repair must never substitute for effect proof. References: [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction) and [Database Migrations guide](https://supabase.com/docs/guides/deployment/database-migrations).

1. Confirm the pinned Supabase CLI version and discover flags from that version's --help; do not copy commands from docs without validating the installed CLI interface.
2. On paper first, produce a per-version proposed transition list. For every applied or reverted status, state the exact row, why its schema/data effect is already present or safely absent, whether subsequent canonical SQL would duplicate or damage the effect, and the recovery action.
3. Compare two outcomes before selecting one:
   - **Retain mismatch / no writes:** legitimate if history normalization risk outweighs the benefit; D7 remains a blocker and future releases must not run an unqualified push.
   - **CLI-supported metadata reconciliation:** propose only if P1 mapping and P2 tests prove each transition safe. This requires a separate approval; no direct DML against supabase_migrations.schema_migrations.
4. Do not add duplicate/archival alias SQL files to active supabase/migrations merely to align timestamps; a fresh database could replay those statements. Do not bulk-mark 51 migrations applied, bulk-revert 54 remote rows, or run db push “to see what happens.”
5. Rehearse the exact version transitions and subsequent migration list/dry-run in a disposable database with a staging-representative starting condition. If the environment cannot represent relevant state, document that limitation and do not claim equivalence.
6. **P3 exit gate:** design review approves one exact safe transition sequence or explicitly chooses to keep the no-write mismatch. If CLI still reports remote versions absent locally or dry-run proposes unexpected SQL, D7 remains open and P5/P6 cannot proceed.

### P4 — Backup and recovery readiness

1. Verify in the actual staging project's dashboard/plan which backup/PITR capabilities, retention windows and restore permissions exist; never assume PITR is available.
2. Select a recovery point that predates the proposed change. Record UTC time, project reference, backup identity, expected coverage (schema, migration history, financial tables, auth/fixtures) and exclusions.
3. Write a step-by-step recovery runbook with actor/permission requirements, project-ref confirmation, restore action and post-restore verification. Leave duration unspecified until provider details are verified.
4. Rehearse recovery in disposable infrastructure. If provider restore cannot be safely rehearsed there, document the limitation, alternative export/snapshot and residual risk.
5. Define immediate abort triggers: target/ref mismatch; unexpected dry-run plan; unrecognized row transition; lock/permission failures; unexpected SQL effects; RLS/grant/function fingerprint drift; any financial invariant violation; or inability to verify the recovery point.
6. **P4 exit gate:** recovery path and limitations are reviewed and independently checked. A downloadable backup alone does not prove recoverability.

### P5 — Final staging-only preflight (read-only)

1. Verify the approved branch/commit is the one used for rehearsal and test results reference that SHA.
2. Pin target to staging njjybpswxalxjhqjlvqa, validate hostname/project reference without printing credentials, and confirm no production credential/target is selectable for any runbook command.
3. Capture before-state snapshots: 54-row migration history; catalog/function fingerprints; grants/RLS; unique constraints/indexes; UUID defaults; scheduler jobs/readiness; queue/dead-letter counts; unsettled settlements and ledger anomaly counts. Keep secrets and sensitive payloads out of logs/artifacts.
4. Run read-only migration list and db push --dry-run; compare output line by line to the expected postcondition signed in P3.
5. **P5 exit gate:** no unexplained output, complete before-state evidence, verified recovery plan, and separate explicit go/no-go. If D7 remains unpaired, this phase ends NO-GO regardless of Quality/replay results.

### P6 — Bounded staging execution (not authorized)

This phase is a runbook template only. No command in this phase may run under the current approval.

If and only if P1–P5 pass and the user separately approves the exact execution list:
1. Reconfirm staging ref and recovery point immediately before the first command.
2. Apply only the approved CLI-supported metadata transitions, if selected by P3; never issue direct history-table DML.
3. Execute one bounded change/checkpoint at a time. Immediately re-run read-only history list and targeted catalog/financial checks after each checkpoint.
4. Stop on the first difference from expected state. No automatic retries, scope widening, “fix forward” SQL or production fallback.
5. Do not run normal db push if the approved runbook authorizes only history metadata repair, or vice versa. Command type and exact versions must match separately approved runbook.

### P7 — Post-change verification and closeout (not authorized until P6)

1. Verify expected history map and that local/remote version pairing matches the chosen mechanism.
2. Require db push --dry-run to propose no unexpected migration SQL; if it still fails synchronization or offers unreviewed SQL, stop and keep the task open.
3. Recheck catalog fingerprints, role grants, search_path, RLS/policies, constraints/unique indexes, UUID defaults, scheduler freshness/full-integrity readiness, queue/dead letters, settlement and financial-ledger invariants.
4. Run complete disposable replay and contract suite at the same commit; review Quality/build results.
5. Publish before/after evidence, every approved version transition, accepted source exceptions D1–D3/D6/D11, behavior exceptions, and proof production was untouched.
6. Keep all residual blockers named explicitly. An accepted exception is not verified equivalence.

### Proposed sequencing and dependencies

P0 (complete) → P1 (complete as the baseline 54-row / 51-file inventory) → P2 (complete: 14 SQL files / 238 assertions plus historical pre-state and cross-session races pass) → P3 (blocked by D7; source-backed CLI/history strategy) → P4 (backup/restore rehearsal) → P5 (read-only preflight) → separate user go/no-go → P6 (if separately approved) → P7 (if completed).

The current code branch includes a new proposed P2 readiness migration, so it has 52 local migration files; that file is outside the frozen P1 51-file map and is not represented as already deployed. P2's agreed disposable behavioral matrix is complete, but D4/D5 and H2.1 retain historical source-attribution limitations. P3 still depends on a source-backed strategy for the D7 version mismatch; P4 depends on a concrete P3 proposal so recovery covers actual risks. P5/P6 cannot proceed while D7 remains open. Approval of D1–D12 and passing disposable tests do not change this order.

---

## P3 CLI transition gate — 2026-10-16 (authoritative current outcome)

P3 has produced a full transition register for all **54 staging history rows** and **52 local migration files** in [the P3 CLI transition register](./staging-reconciliation-p3-cli-transition-register-2026-10-16.md). The latest implementation head before this documentation-only refresh (`979e6c93ccfb4917f5624119e0fb939f72c819ae`) has [Quality PASS, run 38886934535](https://github.com/fsoeltonione/nextaction/actions/runs/38886934535) and [Disposable Migration Replay PASS, run 38886934606](https://github.com/fsoeltonione/nextaction/actions/runs/38886934606); the read-only staging CLI gate [run 38886934583](https://github.com/fsoeltonione/nextaction/actions/runs/38886934583) still fails closed at **0 paired / 52 local-only / 54 remote-only**, with no writes executed.

**P3 decision: NO-GO on metadata reconciliation.** Preserve the mismatch as an interim hold state. The content/effect mappings in P1 do not create timestamp matches in the CLI, and there is no evidence-backed one-to-one transition set. In particular, do not mark the branch-only `20261015120000_runtime_full_integrity_readiness.sql` as applied. The exact CLI mutation rehearsal is deferred because no proposed mutation sequence passes source/effect preconditions; the current read-only list/dry-run remains evidence of the blocker, not approval to repair it.

P2's agreed disposable contracts are complete, but P2 does not establish hosted history convergence. D7 remains OPEN; P4 backup/restore readiness and P5 preflight cannot close D7, and P5 remains NO-GO. **HOLD — NO DATABASE WRITES. PR #141 stays open and Draft.** This update supersedes earlier sequencing text that described P3 only as a future phase.
