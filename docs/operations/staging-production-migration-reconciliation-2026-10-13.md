# Staging/production migration reconciliation — 2026-10-13

## Scope and safety

This note records a read-only comparison of Supabase project `njjybpswxalxjhqjlvqa` (staging) and `khoygjyikxkdwonygzyh` (production), against `master` as observed on 2026-10-13. No hosted database was changed and no migration history row was edited.

Both databases reported 52 migration-history entries. The repository manifest had 49 canonical migration files. A history row with a changed version/name must not be treated as equivalent solely because counts match; current database state and the later migrations that supersede earlier effects must also be checked.

## The three production history mappings that needed investigation

### 1. `20260926010000_stage_8_function_grant_hardening.sql`

**Finding: current security effect is superseded; do not backfill its old grant state.**

The file revokes `PUBLIC` and `anon` on three legacy activation functions, then grants `authenticated` execution. Production has no matching history row for this extra Stage 8 file. The later canonical `20260929010000_stage_16_read_only_control_plane.sql` explicitly revokes `PUBLIC`, `anon`, and `authenticated` on those legacy functions and grants execution to `service_role`. The live privilege check matched that later state in both environments: `anon=false`, `authenticated=false`, `service_role=true` for all three functions.

Therefore, this missing old history row is not evidence that production should receive the older authenticated grant. Applying it now would re-open an access path that the later security boundary intentionally closed. Record it as **superseded by a later security migration**, not as an outstanding migration to execute.

### 2. `20260926050000_stage_9_runtime_rate_limit_reconciliation.sql`

**Finding: partial/old behavior existed in production, but the canonical scope-normalization behavior did not. This is the actionable drift.**

Staging's live `public.check_runtime_rate_limit(text,text,integer,integer)` body matches the canonical reconciliation implementation. Production had an atomic `INSERT ... ON CONFLICT ... DO UPDATE` implementation, but it validated using a trimmed scope while storing the original `p_scope`. For example, the scope values `"  api_event  "` and `"api_event"` could create separate counter buckets in production. The canonical implementation persists `pg_catalog.btrim(p_scope)` and uses one timestamp snapshot for the window calculation.

This explains why the missing history row was not safely inferable from object counts: production had the broad atomic-upsert shape but did not have the full canonical behavior. The remediation in this PR adds a new forward-only migration, `20261013010000_rate_limit_scope_normalization.sql`, plus a regression test covering padded/unpadded scopes. The old history will not be rewritten.

### 3. `20261003010000_stage_17_smoke_verifier_fix.sql`

**Finding: the corrected effect is present through the later final reconciliation. Do not re-run/backfill the historical fix independently.**

The missing standalone history row is named `stage_17_smoke_verifier_fix` in staging but is absent in production. The later canonical `20261003020000_stage_17_final_reconcile.sql` also contains the corrected smoke verifier, ordering the latest click by `private.clicks.clicked_at DESC, id DESC`. The live `public.production_smoke_fixture_verify(uuid,uuid)` body in both environments contains `ORDER BY c.clicked_at DESC, c.id DESC`. That is the required correction, so a separate history backfill would add no value and could misrepresent the actual order of historical deployment.

## Other comparison checks

- PostgreSQL engine/version: both reported PostgreSQL 17, version 17.6.1.166.
- Catalog counts: both reported 80 relations, 668 columns, 256 constraints, 223 indexes, 48 RLS policies, 14 non-internal triggers, 90 non-extension functions/procedures, 6 sequences, 12 user-defined enum/domain/range types, and 7 installed extensions.
- Index definitions: 223 of 223 matched, including validity/readiness flags.
- Installed extensions: the same seven extensions, versions, and schemas were present.
- Schedulers: the same three active jobs and commands were present: runtime worker every minute; integrity audit every five minutes; operations tick every five minutes. Numeric `cron.jobid` values differ as expected between databases.
- A grant difference also exists for schema `pgmq`: production grants `USAGE` to `service_role`, staging does not. This is separate from the three file mappings and is still a policy decision to reconcile; this PR does not change it.
- Four defaults render differently for `gen_random_uuid()` (schema-qualified in staging, unqualified in production). They are likely semantically equivalent but remain a catalog rendering/declaration difference to document or normalize separately.

## Verification plan for the rate-limit fix

The disposable migration replay must apply the new migration after the existing canonical chain and run `supabase test db --local`. The new pgTAP test checks that:
1. the first padded scope request starts at count one;
2. an unpadded call increments that same scope to count two; and
3. only one row exists for the equivalent scope representations.

Hosted staging/production deployment is intentionally out of scope for this PR. After the PR and disposable tests pass, re-check the two live function bodies and their grants. Then stage the new migration through the approved migration process only after the broader migration manifest/history reconciliation is reviewed. Do not use manual `schema_migrations` edits to make the ledgers look equal.
