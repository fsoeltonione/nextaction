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
