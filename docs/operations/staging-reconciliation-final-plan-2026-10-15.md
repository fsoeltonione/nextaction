# Final Staging Migration Reconciliation Plan & Disposition Register — 2026-10-15

## 1. Decision and safety boundary

**Decision: HOLD — NO DATABASE WRITES.** This is a conditional plan and an explicit disposition request, not execution authorization.

- In scope for eventual reconciliation: staging project `njjybpswxalxjhqjlvqa` only.
- Explicitly out of scope: production project `khoygjyikxkdwonygzyh`. No production writes or migration actions are authorized by this document.
- Prohibited while HOLD remains: `supabase db push` without `--dry-run`, `supabase migration repair`, direct DML/DDL against `supabase_migrations.schema_migrations`, replaying legacy fixture SQL against hosted staging, and applying any proposed function/catalog normalization.
- The migration manifest and earlier decision matrix are the detailed evidence sources. This document makes their open decisions explicit; it does not upgrade partial/effect-only evidence into exact source provenance.

A user acceptance of an unresolved evidence gap may authorize documenting that limitation as an audit exception. It does **not** make the CLI gate pass and does **not** authorize any database write.

## 2. Evidence snapshot at the latest checked PR head

Repository: [fsoeltonione/nextaction](https://github.com/fsoeltonione/nextaction), PR [#141](https://github.com/fsoeltonione/nextaction/pull/141), branch `audit/staging-migration-lineage-20261014`, head `e338821cd5394c89ada6eb3400c4346dd7063168\). PR remains **open and Draft**.

- The manifest covers 54 staging history rows, 54 production history rows, and 51 local SQL migration files. Exact full-file payload matches were 27/54 in staging and 24/54 in production; 14 local SQL files have no strict full-file payload match in either hosted history. No exact match does not establish that a migration was unapplied.
- Staging remote version keys have zero exact overlap with current local filename prefixes.
- Latest staging-only CLI run [38615138956](https://github.com/fsoeltonione/nextaction/actions/runs/38615138956) passed target validation and ran the read-only migration list and `db push --dry-run`; the final gate failed: **0 paired, 51 local-only, 54 remote-only**. The command reported remote migration versions missing from the local migrations directory. No write command ran.
- Latest disposable replay before this plan refresh [38615138763](https://github.com/fsoeltonione/nextaction/actions/runs/38615138763) passed and reports all four SQL contract files successful. Latest Quality run before this plan refresh [38615138881](https://github.com/fsoeltonione/nextaction/actions/runs/38615138881) passed. These prove the tested source chain/contracts in an isolated database; neither proves hosted staging history is synchronized.
- Task 5 observed six cross-environment function-definition fingerprint differences and four UUID default-expression differences. No live function, table default, grant, RLS policy, index, or migration-history row was changed by Tasks 1–6.

## 3. Disposition register — approved 2026-10-15

The user approved all D1–D12 dispositions in this register on 2026-10-15. This approval accepts each documented classification/status and the proposed treatment; it does **not** certify missing source artifacts as found, close the behavior tests designated OPEN, waive the CLI blocker, or authorize database writes. The execution gate remains separate.

| ID | Gap / verified evidence | **Approved disposition (2026-10-15)** | Scope / limitation of approval |
|---|---|---|---|
| **D1** | Stage 14 bootstrap, staging row `20260926122918`: stored body matches the four table-creation statements in the later expanded sidecar, but the original pre-sidecar source blob is unbound. The sidecar also contains an auth fixture statement absent from this payload. | **APPROVED — legacy staging-only bootstrap with partial/superseded source provenance; preserve the remote row and do not replay it.** Retain the source limitation in the ledger. | Accepts a permanent or until-found source-blob limitation; does not assert that the sidecar was the original applied artifact. |
| **D2** | Stage 14 credit fixture, row `20260926215632`: the 263-character UPDATE of the Stage 14 Advertiser credit account is absent from checked-in seed revisions. A later seed change corroborates intended fixture capacity but not the exact SQL source. | **APPROVED — historical fixture normalization, not a canonical product migration; preserve the row and never rerun it on hosted staging.** | Accepts incomplete source identity for a test-fixture mutation only. It cannot be reused against another workspace/environment. |
| **D3** | Stage 9 rate-limit reconciliation, row `20260926123146`: executable body matches the Stage 14 sidecar after removing comments/transaction wrappers; exact source artifact at application time is unbound. Later scope-normalization migration corroborates current behavior. | **APPROVED — executable-body match plus an open original-source attribution note; retain history unchanged and use the later forward correction as current-behavior evidence.** | Does not claim exact whole-file provenance and does not authorize a history rewrite. |
| **D4** | Stage 17 second remediation, row `20261003154220`: some blocks match current source, but constraint-guard logic differs and its verifier used `created_at` rather than `clicked_at`. The subsequent verifier-fix row maps exactly to its source. | **APPROVED — KEEP OPEN:** exact historical source identity until the partial constraint behavior has a documented isolated comparison. Preserve the applied row; do not replay or replace it. | This is a financial/settlement control. Acceptance of a source gap alone is insufficient to assert that its behavior is safe; require regression evidence for the final effective constraint/verifier contract. |
| **D5** | Stage 17 final reconcile, row `20261003154641`: remaining executable body matches after excluding a differing constraint block; current logic uses an existing unique index with `UNIQUE USING INDEX`. Live staging has a valid unique settlement/Qualified Click invariant, with zero NULL and duplicate keys in the prior read-only check. | **APPROVED — KEEP OPEN:** full source attribution until the constraint/index difference is covered by a disposable test and recorded. Preserve the remote row and current business-uniqueness objects. | Does not imply the historical constraint DDL is interchangeable or authorize index/constraint DDL in staging. |
| **D6** | H2.1, staging row `20261003175300`: normalized executable body and active worker behavior match after omitting the source candidate's unused `v_attempts INTEGER` declaration, but exact whole-file source blob is unbound. | **APPROVED — accept executable-body match as effect evidence; retain original-blob identity as an explicit audit exception if further Git-history recovery finds nothing. No replay or history edit.** | Closes no more than the provenance classification. Retry exhaustion, quarantine, archive-failure and concurrent-worker tests remain separate gates. |
| **D7** | CLI sync gate: zero paired versions, 51 local-only, 54 remote-only on latest checked run. | **APPROVED — KEEP OPEN BLOCKER; do not waive as a pass.** The release/reconciliation plan stops before execution until evidence-backed pairing is resolved. An explicit decision to accept this blocker means **remain in no-write mode and keep PR #141 Draft**. | This is the critical gate. Accepting “blocker remains open” is not an exception that permits `db push`, `migration repair`, merge, or production action. |
| **D8** | Six function fingerprint differences: `runtime_accept_event`, `runtime_worker_tick`, `private.runtime_quarantine_message`, `runtime_readiness`, `confirm_product_activation`, and `resolve_runtime_integration`. Only the core acceptance behavior has a new focused contract with 10 passing disposable assertions; other semantic comparisons are incomplete. | **APPROVED — KEEP OPEN** for behavior closure on untested cases; do not replace live functions to make hashes equal. Preserve `runtime_accept_event`'s passing test as limited evidence, not full equivalence certification. | Requires the targeted differential/negative-path contracts in the decision matrix before any behavior-change proposal can be considered. |
| **D9** | Activation v2 wrappers and some private `SECURITY DEFINER` helper implementations grant `authenticated` EXECUTE; helpers have authorization checks but the existing 78-assertion RPC contract verifies catalog/ACL shape rather than full tenant-isolation behavior. | **APPROVED — KEEP OPEN pending disposable role-based tests** for non-member/wrong-workspace, missing capability, invalid IDs/input, and anon denial. Do not label the grant alone a vulnerability. | Closes only after tests demonstrate the tenant/capability boundary for the exposed helper paths. |
| **D10** | `runtime_readiness()` reported `ready` with empty queue and recent worker/operations successes, but its current body does not check the integrity-audit scheduler/latest snapshot. | **APPROVED — FULL-INTEGRITY readiness contract:** add integrity-audit scheduler/latest-snapshot freshness assertions before claiming full operational readiness. No live function change now. No live function change now. | Requires an approved health-contract definition and isolated tests for missing, inactive, stale and successful integrity-audit runs. |
| **D11** | Four staging UUID defaults use `extensions.gen_random_uuid()`; previous cross-environment inspection recorded unqualified `gen_random_uuid()` in production. | **APPROVED PROVISIONALLY — likely schema-qualification-only difference; retain both forms until disposable resolution tests confirm equivalent UUID generation and extension binding.** | Does not authorize normalizing defaults or treating different catalog text as a migration blocker by itself. |
| **D12** | Behavior contracts remain incomplete for worker retry/quarantine, inactive/unavailable H3 network mappings, H4 `no_capacity` recovery, and duplicate settlement/ledger prevention under repeat/concurrent calls. | **APPROVED — KEEP FINANCIAL/RUNTIME REGRESSION GATE OPEN.** Add and pass disposable contracts before any reconciliation execution is separately proposed. | A clean catalog or zero-row live anomaly count is not a substitute for these tests. No production financial event may be created to test them. |

### Approval record

**User approval received:** all D1–D12 accepted as listed on 2026-10-15.

- D1–D3 and D6: approved classifications/audit exceptions with no hosted replay.
- D4–D5, D8–D9, and D12: approved to remain OPEN pending their named evidence/tests.
- D7: approved to remain an OPEN CLI blocker; **NO WRITES and PR remains Draft** while it is open.
- D10: approved **FULL-INTEGRITY** as the intended readiness contract; implementing it requires tests and a separate reviewed code-change proposal.
- D11: approved provisionally; no catalog normalization authorized.

The approval applies to dispositions and the plan only. It is not permission to run CLI repair, modify migration history, apply SQL to hosted staging, or touch production.

## 4. Conditional execution plan — only after dispositions and a separate approval

### Phase A — freeze and preserve evidence (no writes)

1. Keep PR #141 Draft and preserve the current branch/head until the disposition response has been recorded.
2. Do not rename, delete, duplicate, or reorder canonical migration files to silence the CLI. Do not place archival remote payload copies in the active `supabase/migrations` directory: the CLI could interpret them as migrations to apply.
3. Keep the per-row manifest as the source of truth. For every remote staging row, maintain: remote version/name; exact stored payload hash/length; source repository path, commit and blob SHA (or explicit unbound classification); behavioral effect; dependency/order; evidence category; chosen disposition; replay risk; acceptance proof.
4. Production remains excluded. Its existing manifest rows are evidence only; production history is not to be repaired as a side effect of staging work.

### Phase B — close or accept provenance rows (no writes)

1. Recover exact historical artifacts for D1–D6 from Git history and any existing archived sidecar/release evidence.
2. If an original file/blob remains unavailable, do not manufacture provenance. Record it as unbound and request an explicit audit-exception acceptance for that row.
3. For D4 and D5, prove the effective unique constraint/index and verifier semantics through disposable migrations/contracts; preserve financial uniqueness and immutable ledger evidence.
4. Keep a source gap “open” if payload differences may change settlement/authorization semantics. A live catalog snapshot can establish present state; it cannot prove which historical file caused it.

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

**HOLD — NO DATABASE WRITES.** Task 6 creates a reviewable proposed plan and asks for explicit dispositions. It does not reconcile hosted history, alter schema, reset data, run repair, change function definitions, or approve/merge PR #141.

Related evidence:
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
| **P1 — Complete staging row/effect map** | Reconcile all 54 staging rows to source/effect/exception and all 51 local migrations to their representation status | GitHub source/history artifacts and read-only staging queries only | **Next** | Every staging row classified; D4/D5 differences described; every local migration categorized; no inferred “unapplied” status from hash mismatch alone |
| **P2 — Close disposable behavioral contracts** | Test effective financial, runtime, readiness, network and workspace boundaries | Isolated local/disposable Supabase only; synthetic IDs/data; rollback-contained tests | **Open** | Existing/new contracts pass from clean replay; negative-path, concurrency and financial invariants pass; no hosted project was the test target |
| **P3 — Design CLI/history convergence** | Select and prove a version-history strategy for the 0/51/54 mismatch | Source analysis, current CLI help, docs review, disposable rehearsal; no hosted repair | **Blocked on P1/P2 evidence** | Row-by-row action map exists; each metadata transition has effect proof, order, stop and recovery conditions; disposable rehearsal yields the intended state |
| **P4 — Backup/restore readiness** | Establish recovery before any potential hosted staging change | Read-only check of actual backup availability; rehearsal in disposable environment; no staging mutation | **Not started** | Backup/PITR availability and retention verified, not assumed; exact recovery steps and access documented; restore rehearsed and independently verified |
| **P5 — Staging go/no-go preflight** | Revalidate target, source head, live history/catalog and expected CLI result | Read-only staging commands/queries only | **Blocked while D7 remains open** | Exact target verified; no production target selectable; current before-state fingerprint captured; CLI gate resolved and dry-run no-op or its reviewed output expressly expected |
| **P6 — Bounded staging change window** | Apply only a separately approved history reconciliation mechanism | **Not authorized now.** Potentially staging only, after separate explicit approval | **NO-GO / HOLD** | Exact commands/versions approved; one bounded metadata change at a time; immediate read-only validation; stop conditions and recovery ready |
| **P7 — Post-change verification and closeout** | Prove history, schema, authorization, financial invariants and operations after any future approved change | Read-only staging verification and disposable regression suite | **Not authorized until P6 separately approved and completed** | Expected history map matches; dry-run has no unexpected SQL; catalog/security/financial/runtime checks pass; residual risks recorded |

### P1 — Complete the 54-row staging / 51-file local map

1. Start from the checked-in manifest, not filenames alone. For each of the 54 staging rows, capture remote version/name, statement length and MD5, mapped source path, source commit and Git blob SHA when available, normalized executable-body comparison, dependency/order, observed effect and confidence category.
2. Apply the approved disposition without overstating evidence:
   - D1/D2: source-identity limitations remain accepted staging-only bootstrap/fixture exceptions; neither is a migration to replay.
   - D3: retain executable-body match and original sidecar-source attribution note.
   - D4/D5: remain open; record the exact constraint/index and verifier behavior to be tested in P2.
   - D6: retain H2.1 executable-body classification and source-blob exception; behavior tests remain in P2.
3. Categorize all 51 local migrations as historical source match; effect represented by a mapped legacy payload; required effect not proven present; superseded/unsafe to replay without further analysis; or no demonstrated mapping. State evidence for every assignment.
4. Identify fixture/smoke/marker rows separately from schema migrations. Do not automatically make them canonical product migrations, delete them, or copy staging-only payloads to production.
5. Compare staging and production only as historical context already present in the manifest; this phase must not query or change production.
6. **P1 exit gate:** a 54-row disposition table and 51-file mapping have no unclassified rows. “Accepted source exception” and “effect not proven” remain distinct. D4/D5 stay OPEN until P2 provides behavioral evidence.

### P2 — Disposable-only behavioral test work

Run the following in isolated replay environments, using synthetic fixtures only. These tests must not point at hosted staging or production.

- **P2.1 Resolver and Event acceptance (D8):** active credential succeeds; malformed/missing credential, revoked/inactive integration, unconfirmed product and missing/inactive make_money fail with specified outcomes; malformed input persists no Event; exact replay returns the same Event ID and queue count; changed payload/event type/timestamp is rejected; no credential/hash is exposed.
- **P2.2 Worker/quarantine (D6/D8/D12):** quantity/visibility bounds; deterministic retry progression; poison/malformed message classification; retry exhaustion; dead-letter upsert preserves one row and updates latest timestamp/request/event metadata; archive success, archive failure and already-missing queue-message paths; concurrent worker claims do not process the same message twice.
- **P2.3 Full-integrity readiness (D10):** define ready to require queue existence, active/recent worker and operations jobs, plus active/recent integrity-audit job and fresh successful integrity snapshot. Test each missing/inactive/stale condition individually and the all-healthy case. This is the approved target contract, not yet a live implementation.
- **P2.4 Workspace/activation boundary (D9):** run as authenticated and anon; invalid/non-member/wrong-workspace IDs; capability absent/inactive; malformed URL/moment/offer data; concurrent first-workspace bootstrap creates exactly one workspace/membership; helper EXECUTE cannot bypass membership and capability checks.
- **P2.5 Stage 17 financial integrity (D4/D5/D12):** compare both historical constraint-guard variants against current effective uniqueness; duplicate Qualified Click settlement is rejected/idempotent as contracted; no NULL or duplicate business keys; replay/concurrent invocation creates no duplicate debit, credit or ledger rows; verifier ordering uses the intended timestamp, including clicked_at where specified by the current contract.
- **P2.6 Network Moment and H4 recovery (D12):** inactive/unavailable mappings are rejected; H4 recovery bound is respected; no_capacity is explicitly retryable; repeated recovery retains stable settlement identity; no duplicate ledger entries.
- **P2.7 UUID defaults (D11):** on disposable schema, demonstrate both schema-qualified and unqualified UUID defaults resolve to the intended extension function and produce non-null UUIDs. Do not normalize hosted defaults.
- Rerun all four existing SQL contract files on canonical from-zero replay and the full Quality workflow. Save exact head SHA and job URLs. A test-suite pass does not close D7.

**P2 exit gate:** all high-impact assertions pass deterministically, concurrency tests repeat reliably, rollback leaves the disposable database clean, and assertions are traceable to D4/D5/D8/D9/D10/D11/D12. Any flake, unexpected persisted row, financial duplication, or tenant escape is a stop condition.

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

P0 (complete) → P1 (54-row map) → P2 (regression contracts) → P3 (CLI strategy and rehearsal) → P4 (backup/restore rehearsal) → P5 (read-only preflight) → separate user go/no-go → P6 (if separately approved) → P7 (if completed).

P1/P2 can use separate read-only/disposable workstreams, but P3 depends on both. P4 depends on a concrete P3 proposal so recovery covers the actual risks. P5/P6 cannot proceed while D7 remains open. Approval of D1–D12 does not change this order.
