# Post-Release Production Baseline

**Audit date:** 2026-09-28  
**Repository:** `fsoeltonione/nextaction`  
**Production Supabase project:** `nextaction`  
**Production release baseline:** merge commit `2453c103e8f8d68a89b87c7a458b752f64d9a903`

## Verified production baseline

The production database is healthy and its schema matches staging substantively across the public/private application tables.

The current pre-existing control-plane data was intentionally preserved during this audit because its provenance as disposable fixture data could not be established safely:

- 2 authenticated users;
- 2 workspaces;
- 3 products;
- 15 moments;
- 0 active workspace capabilities;
- 0 integrations;
- 0 offers;
- 0 runtime events;
- 0 settlements.

The three existing products are two `Carrd` product records and one `Detik` product record. No existing production rows were deleted or mutated by this audit.

## Runtime baseline

Production has:

- PGMQ queue `runtime-events`;
- active `nextaction-runtime-worker` cron job running every minute;
- private schema inaccessible to `anon` and `authenticated`;
- service-role-only private table grants;
- RLS enabled on all application tables.

The production runtime release path is now verified by the release pipeline with an ephemeral smoke fixture rather than requiring permanent production test rows.

## Security advisor findings

Supabase currently reports:

- `RLS enabled, no policy` on private tables. This is expected for the private-schema boundary because the `private` schema is not granted to `anon` or `authenticated`.
- `auth_leaked_password_protection` as a warning on the Free plan. This remains an explicitly accepted product/infrastructure exception and is not silently treated as resolved.

## Cleanup rule

Production smoke fixtures must be isolated, uniquely marked, and removed before the smoke job passes. Existing production workspaces, products, and other non-smoke data must not be treated as disposable without explicit provenance.
