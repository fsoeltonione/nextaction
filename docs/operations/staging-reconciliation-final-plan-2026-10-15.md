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
- Latest staging-only CLI run [38613116804](https://github.com/fsoeltonione/nextaction/actions/runs/38613116804) passed target validation and ran the read-only migration list and `db push --dry-run`; the final gate failed: **0 paired, 51 local-only, 54 remote-only**. The command reported remote migration versions missing from the local migrations directory. No write command ran.
- Latest disposable replay [38613116566](https://github.com/fsoeltonione/nextaction/actions/runs/38613116566) passed and reports all four SQL contract files successful. Latest Quality run [38613116762](https://github.com/fsoeltonione/nextaction/actions/runs/38613116762) passed. These prove the tested source chain/contracts in an isolated database; neither proves hosted staging history is synchronized.
- Task 5 observed six cross-environment function-definition fingerprint differences and four UUID default-expression differences. No live function, table default, grant, RLS policy, index, or migration-history row was changed by Tasks 1–6.

## 3. Disposition register — explicit approval required

“Proposed disposition” is the recommended default for user review, **not yet approved**. For every ID, reply with one of: **ACCEPT PROPOSAL**, **KEEP OPEN**, or **REJECT / AMEND**. If accepted, it closes only the decision on how to document/handle the gap—not the underlying evidence requirement for any future write.

| ID | Gap / verified evidence | Proposed disposition | What accepting it means |
|---|---|---|---|
| **D1** | Stage 14 bootstrap, staging row `20260926122918`: stored body matches the four table-creation statements in the later expanded sidecar, but the original pre-sidecar source blob is unbound. The sidecar also contains an auth fixture statement absent from this payload. | **Accept as legacy staging-only bootstrap with partial/superseded source provenance; preserve the remote row and do not replay it.** Retain the source limitation in the ledger. | Accepts a permanent or until-found source-blob limitation; does not assert that the sidecar was the original applied artifact. |
| **D2** | Stage 14 credit fixture, row `20260926215632`: the 263-character UPDATE of the Stage 14 Advertiser credit account is absent from checked-in seed revisions. A later seed change corroborates intended fixture capacity but not the exact SQL source. | **Accept as historical fixture normalization, not a canonical product migration; preserve the row and never rerun it on hosted staging.** | Accepts incomplete source identity for a test-fixture mutation only. It cannot be reused against another workspace/environment. |
| **D3** | Stage 9 rate-limit reconciliation, row `20260926123146`: executable body matches the Stage 14 sidecar after removing comments/transaction wrappers; exact source artifact at application time is unbound. Later scope-normalization migration corroborates current behavior. | **Accept executable-body match plus an open original-source attribution note; retain history unchanged and use the later forward correction as current-behavior evidence.** | Does not claim exact whole-file provenance and does not authorize a history rewrite. |
| **D4** | Stage 17 second remediation, row `20261003154220`: some blocks match current source, but constraint-guard logic differs and its verifier used `created_at` rather than `clicked_at`. The subsequent verifier-fix row maps exactly to its source. | **Keep exact historical source identity OPEN until the partial constraint behavior has a documented isolated comparison. Preserve the applied row; do not replay or replace it.** | This is a financial/settlement control. Acceptance of a source gap alone is insufficient to assert that its behavior is safe; require regression evidence for the final effective constraint/verifier contract. |
| **D5** | Stage 17 final reconcile, row `20261003154641`: remaining executable body matches after excluding a differing constraint block; current logic uses an existing unique index with `UNIQUE USING INDEX`. Live staging has a valid unique settlement/Qualified Click invariant, with zero NULL and duplicate keys in the prior read-only check. | **Keep full source attribution OPEN until the constraint/index difference is covered by a disposable test and recorded. Preserve the remote row and current business-uniqueness objects.** | Does not imply the historical constraint DDL is interchangeable or authorize index/constraint DDL in staging. |
| **D6** | H2.1, staging row `20261003175300`: normalized executable body and active worker behavior match after omitting the source candidate's unused `v_attempts INTEGER` declaration, but exact whole-file source blob is unbound. | **Accept executable-body match as effect evidence while keeping original-blob identity as an explicit audit exception if further Git-history recovery finds nothing. No replay or history edit.** | Closes no more than the provenance classification. Retry exhaustion, quarantine, archive-failure and concurrent-worker tests remain separate gates. |
| **D7** | CLI sync gate: zero paired versions, 51 local-only, 54 remote-only on latest checked run. | **Keep OPEN BLOCKER; do not waive as a pass.** The release/reconciliation plan stops before execution until evidence-backed pairing is resolved. An explicit decision to accept this blocker means **remain in no-write mode and keep PR #141 Draft**. | This is the critical gate. Accepting “blocker remains open” is not an exception that permits `db push`, `migration repair`, merge, or production action. |
| **D8** | Six function fingerprint differences: `runtime_accept_event`, `runtime_worker_tick`, `private.runtime_quarantine_message`, `runtime_readiness`, `confirm_product_activation`, and `resolve_runtime_integration`. Only the core acceptance behavior has a new focused contract with 10 passing disposable assertions; other semantic comparisons are incomplete. | **Keep behavior closure OPEN for the untested cases; do not replace live functions to make hashes equal.** Preserve `runtime_accept_event`'s passing test as limited evidence, not full equivalence certification. | Requires the targeted differential/negative-path contracts in the decision matrix before any behavior-change proposal can be considered. |
| **D9** | Activation v2 wrappers and some private `SECURITY DEFINER` helper implementations grant `authenticated` EXECUTE; helpers have authorization checks but the existing 78-assertion RPC contract verifies catalog/ACL shape rather than full tenant-isolation behavior. | **Keep open pending disposable role-based tests** for non-member/wrong-workspace, missing capability, invalid IDs/input, and anon denial. Do not label the grant alone a vulnerability. | Closes only after tests demonstrate the tenant/capability boundary for the exposed helper paths. |
| **D10** | `runtime_readiness()` reported `ready` with empty queue and recent worker/operations successes, but its current body does not check the integrity-audit scheduler/latest snapshot. | **Request a product/operations disposition: core worker-readiness only, or full runtime-integrity readiness. Default recommendation: keep the contract explicit and add the integrity-audit freshness assertions before claiming full operational readiness.** No live function change now. | Requires an approved health-contract definition and isolated tests for missing, inactive, stale and successful integrity-audit runs. |
| **D11** | Four staging UUID defaults use `extensions.gen_random_uuid()`; previous cross-environment inspection recorded unqualified `gen_random_uuid()` in production. | **Accept as a likely schema-qualification-only difference provisionally; retain both forms until disposable resolution tests confirm equivalent UUID generation and extension binding.** | Does not authorize normalizing defaults or treating different catalog text as a migration blocker by itself. |
| **D12** | Behavior contracts remain incomplete for worker retry/quarantine, inactive/unavailable H3 network mappings, H4 `no_capacity` recovery, and duplicate settlement/ledger prevention under repeat/concurrent calls. | **Keep financial/runtime regression gate OPEN.** Add and pass disposable contracts before any reconciliation execution is separately proposed. | A clean catalog or zero-row live anomaly count is not a substitute for these tests. No production financial event may be created to test them. |

### Required user disposition response

Please explicitly decide D1–D12. The most safety-preserving initial response is to accept the documentation-only legacy classifications D1–D3 and the qualified provenance classification D6, while keeping D4–D5 and D8–D12 open pending the listed evidence. For D7, the proposed response is specifically **“ACCEPT OPEN BLOCKER — NO WRITES; PR remains Draft.”** This suggested initial response is not approval; no item is treated as accepted until the user says so.

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
