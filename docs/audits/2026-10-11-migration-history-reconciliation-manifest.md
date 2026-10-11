# Supabase migration reconciliation manifest (read-only snapshot)

**Snapshot date:** 2026-10-11  
**Source commit:** `43fab2fffed83fa8eba8cf4e7dab743e61ecb476`  
**Local source:** `supabase/migrations/` on `master`  
**Projects:** staging `njjybpswxalxjhqjlvqa`, production `khoygjyikxkdwonygzyh`

## Safety status

This is a read-only manifest, not a repair plan ready to execute. No Supabase history or schema was changed while collecting it. Do not run `supabase db push` or `supabase migration repair` against staging or production until each entry's SQL is reconciled.

## Counts

- Local SQL files: **49**
- Remote staging migration history entries: **52**
- Remote production migration history entries: **52**
- Remote versions with no matching local filename prefix: staging **52**, production **39**
- Remote records with a candidate filename derived from migration name: staging **50**, production **46**
- Duplicate local timestamp prefixes: **2 pairs**

## Duplicate local filename prefixes

| Prefix | Files |
|---|---|
| `20260926030000` | `20260926030000_stage_12_qualified_click_runtime.sql`<br>`20260926030000_stage_9_runtime_core.sql` |
| `20260926040000` | `20260926040000_stage_13_atomic_settlement_runtime.sql`<br>`20260926040000_stage_9_hardening.sql` |

## Important interpretation

The CSV contains one row per remote history entry and one row per local source file. For remote entries it records version, name, statement count, SQL length, and MD5 of the stored statement array. It also lists local candidates derived from the migration name and any local file whose timestamp prefix equals the remote version.

**A name candidate is not an exact SQL match.** The `statements_md5` field is a fingerprint of the SQL stored in that remote history record, but this snapshot does not yet assert byte-for-byte equality against local file content. Rows are intentionally classified as needing SQL-content comparison. The version/name collision on production H4.2/H4.3 demonstrates why version or name alone cannot be used to repair history.

## Per-row review protocol

1. Fetch the remote `statements` array for the row, hash/compare against candidate file content, and review differences in SQL statements and order.
2. Compare SQL effects with the current schema and catalog (functions, policies, triggers, indexes, grants, cron jobs and data backfills as relevant).
3. Classify the row as `EXACT_SOURCE_MATCH`, `EQUIVALENT_BUT_EDITED`, `REMOTE_ONLY_REQUIRED`, `DUPLICATE_OR_RETRY`, or `HISTORY_ONLY`, with evidence and reviewers.
4. Make a staging-specific and production-specific repair manifest only after these classifications are complete.
5. Validate canonical source with a disposable `supabase db reset`, then staging `supabase migration list --linked` and `supabase db push --dry-run`. Apply any production history change only after an explicit reviewed plan and backup.

## CSV

See `2026-10-11-migration-history-reconciliation-manifest.csv` for the row-level mapping snapshot.
