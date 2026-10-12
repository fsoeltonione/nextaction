# Supabase migration SQL and catalog comparison

**Audit date:** 2026-10-11  
**Source commit:** \`9879cdc1e20b6628e89e087c9577dbccda6fd912\`  
**Projects:** staging \`njjybpswxalxjhqjlvqa\`, production \`khoygjyikxkdwonygzyh\`  
**Tracking issue:** [#105 — reconcile migration history divergence](https://github.com/fsoeltonione/nextaction/issues/105)

## Decision

**Status: NOT VALIDATED — no history repair or migration push is approved.** This document is a supplemental read-only comparison, not a migration repair manifest. All queries in this audit were read-only \`SELECT\` statements. No schema, migration ledger, or production data was modified.

The original [row-level manifest](./2026-10-11-migration-history-reconciliation-manifest.md) still has 49 local migration files, 52 history rows in staging, and 52 in production. Staging has zero remote version prefixes matching a local file prefix; production has 13. Two local timestamp prefixes collide:

- \`20260926030000\`: Stage 9 runtime core and Stage 12 qualified-click runtime.
- \`20260926040000\`: Stage 9 hardening and Stage 13 atomic-settlement runtime.

A version or name is only a candidate link. It is not evidence that the SQL is identical or that it is safe to mark a migration as applied.

## Directly verified examples

Comparisons below read each remote row’s stored \`supabase_migrations.schema_migrations.statements\` and compared it with the candidate source file.

| Remote row | Result |
|---|---|
| Staging Stage 12, version \`20260926123202\` | Byte-for-byte match with local \`20260926030000_stage_12_qualified_click_runtime.sql\`. |
| Staging Stage 13, version \`20260926123209\` | Byte-for-byte match with local \`20260926040000_stage_13_atomic_settlement_runtime.sql\`. |
| Staging/production H4.2 rows | Byte-for-byte match with local \`20261011105000_h4_2_rpc_security_and_index_audit.sql\`, despite different remote versions. |
| Staging H4.3 and production H4.3 | Byte-for-byte match with \`20261011110000_h4_3_redundant_financial_index.sql\`. Production version \`20261011105000\` collides with the H4.2 local filename prefix, but its name and SQL match H4.3. |
| Production H4.4 | Byte-for-byte match with \`20261011120000_h4_4_redundant_financial_accounts_index.sql\`. Staging H4.4 differs in comments; its statement is only a comment-normalized candidate and needs human review. |
| Production Stage 9 runtime core, version \`20260925214730\` | **Not a match**: remote SQL is 18,167 characters; current local candidate is 23,042 characters. |
| Production Stage 9 hardening, version \`20260925215210\` | **Not a match**: remote SQL is 8,846 characters; current local candidate is 12,276 characters. |
| Production Stage 6 foundation, version \`20260925205217\` | **Critical mismatch**: remote stored statement is 144 characters versus 29,549 characters in the local candidate. It cannot safely be treated as the applied local file. |
| Production Stage 8 activation/capability history | Multiple name-derived candidates differ materially from stored remote SQL; names alone are insufficient for repair. |
| Production Stage 9 reconciliation history | Six remote-only entries have no corresponding local candidate: versions \`20260925215138\`, \`20260925215209\`, \`20260925215231\`, \`20260925215322\`, \`20260925215343\`, \`20260925215416\`. Their SQL contains changes to runtime rate-limit and decision/delivery functions; they must be preserved/reconstructed or classified with evidence, not discarded blindly. |
| Staging history without a local candidate | \`20260926122918 stage14_staging_bootstrap\` and \`20260926215632 stage14_make_credit_fixture_repeatable\`. The stored SQL creates core public tables or updates a private credit fixture, respectively. Their provenance/effects remain unresolved. |
| Staging/production Stage 17, H2.1, H2.2, H2.3 | At least several stored statements differ in content/length from current local candidates. They are not eligible for automatic version/name reconciliation. |

“Comment-normalized” comparisons deliberately do not count as exact matches. SQL comments, statement order, and DDL effects must be reviewed before using that classification. Similarly, matching normalized text does not establish that a remote-only migration is obsolete or safe to omit.

## Full remote-SQL-to-local-source comparison

The 104 current remote history entries were each compared against **all 49 local SQL files**, not only the filename/name-derived candidate. The stored statement count and statement character length were re-queried after the comparison: 52 rows per project, and all statement counts and character lengths still match the original snapshot. This is a consistency check on the captured snapshot, not a schema repair and not an MD5 re-computation.

| Classification | Rows | Interpretation |
|---|---:|---|
| \`EXACT_SOURCE_MATCH\` | 50 | Byte-for-byte SQL source match found somewhere in local migrations. Remote version/name still need separate review. |
| \`WHITESPACE_NORMALIZED_MATCH_REVIEW\` | 12 | Match after normalizing whitespace outside quoted SQL strings; human review remains necessary. |
| \`COMMENT_NORMALIZED_MATCH_REVIEW\` | 9 | Match after normalizing whitespace and removing SQL comments; review comments and intended source mapping. |
| \`CONTENT_MISMATCH_REVIEW_REQUIRED\` | 25 | Name/version candidate exists but none of the 49 local files matches exactly or under the two normalization rules. |
| \`REMOTE_ONLY_SQL_REVIEW_REQUIRED\` | 8 | No local candidate match was found; these cannot be marked obsolete or history-only by inference. |
| **Total** | **104** | All 52 staging and 52 production history rows accounted for in the comparison output. |

The source-coverage CSV lists every local file with matched staging/production history versions and candidates that need further review. Thirteen local files have no byte-exact match to any remote history statement (some may match only after whitespace/comment normalization):

- \`20260926030000_stage_9_runtime_core.sql\`
- \`20260926050000_stage_9_runtime_rate_limit_reconciliation.sql\`
- \`20260928233000_stage_16_atomic_integration_credential_provisioning.sql\`
- \`20260929000500_stage_16_private_credential_verification_boundary.sql\`
- \`20260929010000_stage_16_read_only_control_plane.sql\`
- \`20261003000000_stage_17_remediation.sql\`
- \`20261003020000_stage_17_final_reconcile.sql\`
- \`20261004010000_h2_1_runtime_failure_containment.sql\`
- \`20261004020000_h2_2_recovery_operations.sql\`
- \`20261004021000_h2_2_runtime_ops_hardening.sql\`
- \`20261004030000_h2_3_release_reliability_proof.sql\`
- \`20261011010000_stage_16_moment_key_semantics.sql\`
- \`20261011020000_h4_1_unsettled_settlement_recovery.sql\`

These status classes are **evidence for review, not a declaration of migration equivalence**. In particular, a normalized match does not authorize \`migration repair\`: effect order, DDL/function behavior, data backfills, remote version identity, duplicate/retry status and dependency ordering all need a reviewed decision.

The review CSV contains one row per remote history record: [migration SQL content review](./2026-10-11-migration-sql-content-review.csv). The complementary inventory shows which local files have exact, whitespace-normalized, comment-normalized, or mismatched history candidates: [local migration source coverage](./2026-10-11-local-migration-source-coverage.csv).

## Read-only current-catalog comparison

The audit compared objects in \`public\` and \`private\` on both projects. This is a catalog comparison, not proof that migration histories or all schemas/extensions are equivalent.

| Catalog surface | Staging | Production | Finding |
|---|---:|---:|---|
| Columns in \`public\`/\`private\` | 175 | 175 | No missing column identities found in this scope. Four defaults differ. |
| Functions/procedures | 41 | 41 | Same observed signatures, but 7 function definitions differ. |
| Indexes | 74 | 74 | Same names and definitions in this comparison. |
| Policies | 46 | 46 | Same observed definitions. |
| Triggers | 10 | 10 | Same observed definitions. |
| Constraints | 112 | 112 | Same observed definitions. |

The four column-default differences are the \`id\` defaults on \`public.moments\`, \`public.offers\`, \`public.products\`, and \`public.workspaces\`: staging uses \`extensions.gen_random_uuid()\`; production uses \`gen_random_uuid()\`.

The seven function-body differences are:

- \`private.runtime_quarantine_message(...)\`
- \`public.check_runtime_rate_limit(...)\`
- \`public.confirm_product_activation(...)\`
- \`public.resolve_runtime_integration(...)\`
- \`public.runtime_accept_event(...)\`
- \`public.runtime_readiness()\`
- \`public.runtime_worker_tick(...)\`

Both projects showed \`SECURITY DEFINER\` on these seven functions in the queried catalog. Several differences appear substantive rather than formatting-only; for example, the queue-quarantine procedure refers to \`last_seen_at\` in staging but not production, and \`check_runtime_rate_limit\` uses a different body. Their exact intended behavior and canonical source must be reviewed before choosing which project is authoritative.

## Why this is not yet a validated manifest

The results show that many entries are exact matches, but the remaining history includes remote-only migrations and non-matching SQL with material runtime behavior. The live catalogs being mostly aligned in indexes, policies, triggers and constraints does not explain the divergent function definitions or prove a clean local reset will reproduce either environment.

## Required next steps — still no production mutation

1. For every one of the 104 remote history rows, keep the exact stored SQL, candidate source, content hash, and a line-level SQL diff together.
2. Classify each row with evidence as \`EXACT_SOURCE_MATCH\`, \`WHITESPACE_ONLY_MATCH\`, \`EQUIVALENT_BUT_EDITED\`, \`REMOTE_ONLY_REQUIRED\`, \`DUPLICATE_OR_RETRY\`, or \`HISTORY_ONLY\`. Do not assign the last three merely from names, timestamps, or current object existence.
3. Reconstruct missing/legacy SQL into a canonical migration source where its effects are required. Review the Stage 6 foundation, Stage 8 activation differences, Stage 9 history and Stage 17/H2 differences first.
4. Resolve duplicate local timestamp prefixes without changing the meaning/order of already applied SQL.
5. On a disposable database, run a clean \`supabase db reset\`, compare its catalog signature with the intended canonical schema, and test the planned migration list and dry-run against staging only.
6. Validate a project-specific staging plan first. Production history changes require an explicit reviewed manifest, backup, and separate authorization.

**Never run \`supabase db push\` or \`supabase migration repair\` against production before these gates pass.** A migration-history repair changes what the migration system believes ran; it does not execute the missing SQL or reconcile actual schema state.


## Live catalog follow-up — 2026-10-12 (read-only)

**Source revision inspected:** `8737736fbe7b051f96a9e3be4a35f7ab68bbae5d` on `master`.  
**Live projects re-queried:** staging `njjybpswxalxjhqjlvqa`; production `khoygjyikxkdwonygzyh`. Both projects reported `ACTIVE_HEALTHY`. Only SELECT/catalog queries were run.

### Current-history consistency

Both live projects still report 52 migration-history rows. The per-row statement counts/lengths match the previous audit snapshot. This confirms that the captured history has not changed; it does **not** validate the repair mapping.

A critical example remains: production version `20260925205217`, named `stage_6_production_foundation`, stores only a comment saying the foundation was previously applied through the SQL execution path followed by `SELECT 1;` (144 characters total). The current local `20260925205217_stage_6_production_foundation.sql` is 29,549 characters. This remote row is a **history marker**, not evidence that the full local SQL is what the migration runner executed. The actual effect must be established from current schema/data and the original execution evidence; do not mark it as an exact source match.

### Live routine catalog comparison

A fresh catalog query returned 41 functions in each project. Seven function definition fingerprints differ. Token comparison (ignoring layout/case while preserving literal strings) further separates likely behavioral drift from formatting differences:

| Function | Staging vs production result | Disposition |
|---|---|---|
| `public.check_runtime_rate_limit(text,text,integer,integer)` | Staging inserts `pg_catalog.btrim(p_scope)` as the bucket scope; production inserts raw `p_scope`. Both validate trimmed length. | **Behavioral drift candidate.** Calls containing surrounding whitespace can map to different rate-limit buckets in production and staging. Review the caller contract and canonical scope rule before repairing. |
| `private.runtime_quarantine_message(...)` | Staging explicitly inserts `last_seen_at` and uses `EXCLUDED.last_seen_at` on conflict; production relies on the column default on insert and sets `last_seen_at = timezone('utc', now())` on conflict. The current column default is the same UTC `now()` expression in both projects. | Likely intended to be equivalent under the observed default, but retain as **manual semantic review** until the complete insert/update semantics are checked. |
| `public.runtime_accept_event(...)` | Staging uses `jsonb_typeof` / `btrim`; production uses `pg_catalog.jsonb_typeof` / `trim`. Both functions currently have an empty `search_path`. | Likely equivalent built-in calls, but confirm before classifying as equivalent; do not treat matching names alone as evidence. |
| `public.resolve_runtime_integration(text)` | Difference is an alias/qualification style for `public.workspace_capabilities`; both functions have an empty `search_path`. | Appears formatting/qualification-only; record after review. |
| `public.runtime_worker_tick(integer,integer)` | Staging declares an extra `v_now` local variable; production does not. | No behavior change apparent from this difference alone. |
| `public.confirm_product_activation(...)` | Token-identical after whitespace/case normalization. | Formatting-only difference. |
| `public.runtime_readiness()` | Token-identical after whitespace/case normalization. | Formatting-only difference. |

For all seven functions, the live catalog reports matching security attributes between environments: `SECURITY DEFINER`, matching per-function `search_path` configuration, and execution denied to `anon` and `authenticated` while granted to `service_role`. This is useful parity evidence, but it does not resolve the body differences above.

The four `id` defaults on `public.workspaces`, `products`, `moments`, and `offers` still differ textually: staging uses `extensions.gen_random_uuid()`, production uses `gen_random_uuid()`. Types and nullability match; classify this as an outstanding expression-equivalence check, not automatically as either a defect or harmless drift.

### Gate decision

**Manifest remains NOT VALIDATED; no repair is authorized.** The next safe validation items are:

1. Review the full SQL/token diff and call sites for the rate-limit scope drift; check whether any existing persisted bucket scopes or data backfills would be affected.
2. Establish the actual effects of production's Stage 6 history marker and classify all six production-only Stage 9 reconciliation records from their stored SQL and current effects.
3. Finish the remaining per-row semantic classifications and exact object-definition comparison. Equal object counts are insufficient.
4. Run a clean reset and schema signature comparison on a disposable database, then validate the project-specific staging migration list and `db push --dry-run`.

No DDL/DML, `db push`, `migration repair`, production deployment, or database mutation occurred during this follow-up.


## Legacy production Stage 9 SQL inventory — 2026-10-12 (read-only)

The six production rows previously classified as remote-only contain sequential runtime-function rewrites, not empty bookkeeping entries. The stored statements were inspected directly:

| Production version | Stored name | Main effects visible in stored SQL |
|---|---|---|
| `20260925215138` | `stage_9_runtime_reconciliation` | Replaces `public.check_runtime_rate_limit` and `public.runtime_accept_event`; drops `public.runtime_drain_events(integer)`. |
| `20260925215209` | `stage_9_runtime_reconciliation` | Another rewrite of the same rate-limit/event functions and removal of the drain function. |
| `20260925215231` | `stage_9_runtime_hardening` | Again rewrites rate-limit/event functions and drops the drain function. |
| `20260925215322` | `stage_9_runtime_sql_fix` | Rewrites rate-limit/event functions and `public.runtime_process_event(uuid)`. |
| `20260925215343` | `stage_9_runtime_builtin_fix` | Rewrites rate-limit/event functions and `public.runtime_process_event(uuid)` again. |
| `20260925215416` | `stage_9_decision_runtime_hardening` | Replaces `public.runtime_create_decision_delivery(...)`. |

Production row `20260925215210` (`stage_9_hardening`) also differs materially from the current local `20260926040000_stage_9_hardening.sql`: 8,846 stored SQL characters versus 12,276 in source. It defines `create_offer_activation`, `check_runtime_rate_limit`, and `runtime_accept_event` plus grants. These entries represent a historical evolution of runtime RPCs; they must not be deleted or marked reverted solely because the current objects have later definitions.

### Current catalog-to-source matching evidence

The direct function-body comparison against current source files shows that staging exactly matches the current source body for the later rate-limit reconciliation, Stage 9 runtime integration lookup, Stage 9 hardening event acceptance, H2.1 quarantine handling, H2.2 readiness, Stage 16 activation, and H3.1 decision/delivery code. Production exactly matches current source for Stage 16 activation, H2.2 readiness (token-equivalent after PostgreSQL's formatting normalization), and H3.1 decision/delivery. Several production Stage 9 runtime bodies do not match the current local source byte/token-wise, including the rate limiter, integration lookup, and event acceptance. The current `runtime_process_event` and `runtime_worker_tick` bodies in both environments also do not token-match their current local candidate files. A non-match is a review flag, not proof of a defect; all differences need semantic classification.

This supports a safer repair model: preserve and compare the old RPC revisions first, determine which final effects are represented by canonical migrations, and only classify an intermediate history row as superseded after a successful disposable reset and current-schema/data comparison. Do not just mark the six rows reverted.

### Local timestamp collision remains a release-blocking source issue

`scripts/migration-filenames-test.mjs` currently permits the two known duplicate 14-digit prefixes as a legacy exception. They remain real collisions, and the local chronology is not yet safe to normalize by guesswork: Stage 9 runtime core must be ordered before the Stage 10 click runtime it supports, while the current Stage 9 core file has the same prefix as Stage 12 qualified-click runtime. Stage 9 hardening also collides with Stage 13 settlement. Select new unique timestamps only after the intended dependency order and each environment's canonical source mapping are explicitly reviewed.

**Still no database changes:** no DDL/DML, migration repair, migration push, or production deployment occurred in this follow-up. The disposable reset/schema-signature/staging dry-run gates remain incomplete.


## Disposable clean-replay probe — 2026-10-12

A disposable replay was attempted in GitHub Actions using the public-repository hosted runner; the run did not use any hosted Supabase URL, access token, database password, linked project ref, or deploy secret. The probe and logs are available at [PR #132](https://github.com/fsoeltonione/nextaction/pull/132) and [workflow run 38285691183](https://github.com/fsoeltonione/nextaction/actions/runs/38285691183). The draft PR is diagnostic only and is not merged.

To get past the known filename collision during this experiment only, the runner copied the 49 migration SQL files to `RUNNER_TEMP`, copied `supabase/staging/STAGE14_BOOTSTRAP.sql` into the temporary copy as `20260925000000_ci_legacy_prototype_baseline.sql`, and assigned provisional unique timestamps to the Stage 12 and Stage 13 colliding files. No repository migration filename was changed by the test, and the provisional timestamps are not a recommendation for permanent renames.

The local Supabase stack started and began replaying from that temporary baseline. The baseline and ten repository migrations preceding Stage 9 runtime core were accepted by the disposable database. Replay then stopped at the original source file `supabase/migrations/20260926030000_stage_9_runtime_core.sql`, statement 13, while defining `public.check_runtime_rate_limit`:

```text
ERROR: syntax error at or near "FROM" (SQLSTATE 42601)
pg_catalog.extract(epoch FROM pg_catalog.clock_timestamp()) / p_window_seconds
```

The parser error is in the source SQL, not in Supabase account configuration or a hosted database. The existing staging-only sidecar `supabase/staging/STAGE14_STAGE9_RUNTIME_CORE.sql` uses the unqualified special-syntax form `extract(epoch FROM pg_catalog.clock_timestamp())`, corroborating the likely correction needed for a replayable source. The probe's subsequent `supabase db reset --local` attempt reported that the local stack was no longer running because the failed startup had stopped its containers; that is secondary to the source SQL syntax failure.

### Interpretation and gate

- **Clean replay is not currently proven.** Even after test-only migration-version normalization and a temporary legacy schema baseline, source SQL stops the chain before later migrations can be tested.
- This run does not establish that the hosted staging/production functions are wrong; the remote catalog may reflect separately applied corrected SQL, and that must be reconciled from the stored ledgers and effects.
- Do not fix this by modifying the hosted databases, running `db push`, or repairing any migration history.
- Before choosing a permanent source correction, compare the broken file to the matching stored Stage 9 SQL across both projects and to the existing staging sidecar. Then use a reviewed canonical-source change, rerun the disposable replay to its next blocker/success, compare schema signatures, and only afterward continue the staging `migration list` / `db push --dry-run` gate.

No hosted database mutation, `db push`, migration repair, or deployment occurred in this probe.


## Disposable compatibility replay follow-up — 2026-10-12

A second isolated GitHub Actions pass completed successfully: [run 38286329231](https://github.com/fsoeltonione/nextaction/actions/runs/38286329231); diagnostic logs artifact: [migration-replay-probe-logs](https://github.com/fsoeltonione/nextaction/actions/runs/38286329231/artifacts/11764220597). This pass used the same temporary legacy baseline and temporary timestamp normalization described above, but replaced the Stage 9 runtime-core migration **only within the runner's temporary copy** with the existing `supabase/staging/STAGE14_STAGE9_RUNTIME_CORE.sql` compatibility sidecar. In that disposable copy, `supabase start` and `supabase db reset --local` both completed successfully, and the complete test-only migration sequence replayed.

This follow-up helps separate two questions:

1. **SQL execution with the existing staging-compatible Stage 9 implementation:** passed in a newly initialized local Supabase database with a temporary baseline and test-only versions.
2. **Replay of the exact canonical repository SQL with current canonical versions:** still fails. [Run 38285691183](https://github.com/fsoeltonione/nextaction/actions/runs/38285691183) stopped at `20260926030000_stage_9_runtime_core.sql`, where `pg_catalog.extract(epoch FROM pg_catalog.clock_timestamp())` causes `SQLSTATE 42601` at `FROM`. The sidecar substitution in the second pass is diagnostic evidence, not permission to replace or rename the canonical source automatically.

### What this proves—and does not prove

- It confirms the free, local-runner approach is viable; no paid Supabase branch is needed for clean replay diagnosis.
- It confirms a likely concrete source blocker in the canonical Stage 9 runtime-core migration and that the existing compatibility sidecar gets the disposable chain past that blocker.
- It does **not** prove the hosted staging or production migration ledgers are synchronized, that every local migration is mapped to the right remote SQL, or that the replayed local schema is equivalent to either hosted catalog.
- It does **not** authorize migration repair, remote `db push`, or production changes. No hosted database was addressed by either probe.

### Remaining safe validation sequence

1. Compare the canonical Stage 9 source, both hosted stored-history SQL variants, the current staging/production function definitions, and the staging sidecar; select a canonical correction only after that mapping is reviewed.
2. Rerun the exact-source clean reset after an approved source fix and then generate a schema signature/object-level comparison against staging.
3. Finish the row-by-row migration history manifest and verify staging `migration list` plus `db push --dry-run` without applying changes.
4. Prepare a distinct, evidence-backed production plan and obtain separate approval before any production ledger or schema mutation.

The replay probe PR [#132](https://github.com/fsoeltonione/nextaction/pull/132) remains draft and unmerged. Its temporary timestamp adjustments and Stage 9 sidecar override are strictly test harness behavior, not repository migration edits. No hosted database mutation, `db push`, migration repair, or deployment occurred.
