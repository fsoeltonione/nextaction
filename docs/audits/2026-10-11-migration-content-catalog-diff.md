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
