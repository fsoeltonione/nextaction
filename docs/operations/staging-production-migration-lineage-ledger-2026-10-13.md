# Staging/Production Migration Lineage Ledger — 2026-10-13

## Keputusan gerbang produksi

**STATUS: HOLD — database hardening sudah diterapkan dan diverifikasi; gate rilis MVP tetap HOLD sampai acceptance ujung-ke-ujung lewat.** Keenam payload legacy Stage 9 sudah dipetakan. Scope-normalization kini diterapkan di kedua env, dan direct `USAGE` pada schema `pgmq` sudah dicabut di kedua env. RPC `runtime_readiness()` mengembalikan `ready` ketika dipanggil sebagai `service_role` di staging maupun production. Sisa gate adalah acceptance Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement, termasuk replay/idempotency dan settlement-integrity.

Payload history dan katalog dikumpulkan secara read-only. Dua migration forward-only baru lalu dicatat melalui migration API resmi pada staging dan production: `rate_limit_scope_normalization` (staging `20261013135832`, production `20261013141041`) serta `pgmq_service_role_usage_hardening` (staging `20261013142232`, production `20261013142338`). Tidak ada existing row `schema_migrations` yang diedit manual.

## Baseline dan metode

- Repo: [`fsoeltonione/nextaction`](https://github.com/fsoeltonione/nextaction)
- `master` yang diaudit: [`1d058c40456e483ddb585bf9683100113e2549b0`](https://github.com/fsoeltonione/nextaction/commit/1d058c40456e483ddb585bf9683100113e2549b0)
- Staging project: `njjybpswxalxjhqjlvqa`
- Production project: `khoygjyikxkdwonygzyh`
- Sumber kanonis pada master: **51 file** di `supabase/migrations/`
- History staging: **54 entri**; history production: **54 entri**
- Kategori berikut diberikan per baris, bukan hanya dibandingkan berdasarkan jumlah:
  - **COCOK LANGSUNG** — version cocok dengan timestamp sumber dan slug cocok.
  - **ALIAS/TIMESTAMP HISTORIS** — slug/sumber dapat dipetakan, namun nama/version menggunakan alias atau timestamp deploy historis.
  - **EFEK DIGANTIKAN MIGRASI LEBIH BARU** — SQL historis tidak perlu dijalankan ulang karena state akhir yang dimaksud dibuktikan oleh migrasi/katalog lebih baru.
  - **KHUSUS STAGING** — bootstrap/fixture atau salinan executable untuk staging, bukan source migrasi produksi.
  - **BELUM TERJELASKAN** — bukti yang tersedia tidak mengizinkan mapping unik. Status ini sengaja tidak “ditebak”.
- Selain `version` dan `name`, `supabase_migrations.schema_migrations` menyimpan `statements text[]` dan `rollback text[]`. Kolom `statements` dibaca secara SELECT-only untuk enam entri legacy Stage 9; panjang SQL dan MD5 dari `array_to_string(statements, E'\\n')` cocok dengan manifest statement-level 11 Oktober. Payload tersimpan membuktikan SQL yang dicatat history, tetapi bukan otomatis bukti bahwa seluruh isi pernah hidup dalam satu file Git kanonis.
- Verifikasi source: folder [`supabase/migrations`](https://github.com/fsoeltonione/nextaction/tree/master/supabase/migrations); salinan Stage 14 ada di [`supabase/staging`](https://github.com/fsoeltonione/nextaction/tree/master/supabase/staging).
- Catatan audit pendahuluan: [staging-production-migration-reconciliation-2026-10-13.md](https://github.com/fsoeltonione/nextaction/blob/master/docs/operations/staging-production-migration-reconciliation-2026-10-13.md)
- Migrasi forward-only [`20261013010000_rate_limit_scope_normalization.sql`]

## Ringkasan hasil

| Ukuran | Hasil |
|---|---:|
| File sumber kanonis di master | 51 |
| History staging | 54 (scope-normalization + PGMQ hardening recorded by migration API) |
| History production | 54 (scope-normalization + PGMQ hardening recorded by migration API) |
| History staging berstatus belum terjelaskan | 0 |
| History production berstatus belum terjelaskan | 0 |
| Scope-normalization | Applied and verified in both environments; staging `20261013135832`, production `20261013141041` |

### Bukti katalog yang dicocokkan

Read-only catalog checks pada kedua environment menunjukkan hal berikut:

1. PostgreSQL 17.6.1.166 pada staging dan production.
2. Objek inti yang diperiksa hadir pada keduanya: unique index credential hash; `private.decisions.moment_id`, FK dan index; unique index pada event di moment occurrences.
3. Trigger `trg_validate_offer_moment_tenant` dan fungsi validator tenant lama tidak ada di kedua DB.
4. RPC lama `public.runtime_ack_event` dan `public.runtime_dequeue_events` tidak ada di kedua DB.
5. `public.create_offer_activation` dan `public.production_smoke_fixture_verify` memiliki hash definisi sama pada kedua DB. Verifier memiliki `ORDER BY c.clicked_at DESC, c.id DESC`.
6. Legacy activation RPCs mempunyai grant akhir `anon=false`, `authenticated=false`, `service_role=true` di kedua DB.
7. State schema Stage 14: tidak ada relasi `public.stage14_*` yang tertinggal; satu auth fixture `stage14-smoke@nextaction.invalid` tersisa di staging dan tidak ada di production.
8. Scope normalization kini konvergen: kedua DB menyimpan `pg_catalog.btrim(p_scope)` dan memakai body hash sama (`cbf7a36dae79fa63fd6287a5b1b73278`).
9. PGMQ hardening kini konvergen: `service_role` tidak mempunyai `USAGE` pada schema `pgmq` di kedua DB. Pemanggilan `public.runtime_readiness()` sebagai `service_role` berhasil pada keduanya; status `ready`, queue `runtime-events` tersedia dengan count 0, worker dan operations job aktif serta sukses baru-baru ini.
10. Walau jumlah relation/index/constraint/RLS policy/trigger/function/extension yang diaudit sebelumnya selaras dan semua index definitions yang disampel cocok, itu bukan pengganti lineage SQL per baris.

## A. Semua history staging

| Version | Name di history | Sumber / efek yang dipetakan | Status | Bukti / alasan |
|---|---|---|---|
| `20260926122918` | `stage14_staging_bootstrap` | supabase/staging/STAGE14_BOOTSTRAP.sql | **KHUSUS STAGING** | Bootstrap kompatibilitas STAGE14; fixture auth disposable tersisa hanya di staging. |
| `20260926122939` | `20260925205217_stage_6_production_foundation` | supabase/migrations/20260925205217_stage_6_production_foundation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926122946` | `20260925205428_stage_6_hardening` | supabase/migrations/20260925205428_stage_6_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926122952` | `20260925205723_stage_6_advisor_cleanup` | supabase/migrations/20260925205723_stage_6_advisor_cleanup.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926122959` | `20260925211435_stage_8_activation_foundation` | supabase/migrations/20260925211435_stage_8_activation_foundation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123006` | `20260925211519_stage_8_activation_foundation_hardening` | supabase/migrations/20260925211519_stage_8_activation_foundation_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123013` | `20260925212247_stage_8_capability_enforcement` | supabase/migrations/20260925212247_stage_8_capability_enforcement.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123019` | `20260925212601_stage_8_destination_url_compatibility` | supabase/migrations/20260925212601_stage_8_destination_url_compatibility.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123026` | `20260925212930_stage_8_function_grant_hardening` | supabase/migrations/20260925212930_stage_8_function_grant_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Nama/version historis mengarah ke file sumber dengan timestamp 20260925212930; berbeda dari file grant Stage 8 kedua bertimestamp 20260926010000. |
| `20260926123033` | `20260926010000_stage_8_function_grant_hardening` | supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123123` | `stage14_staging_stage9_runtime_core` | supabase/migrations/20260926030000_stage_9_runtime_core.sql | **KHUSUS STAGING** | Salinan executable staging di supabase/staging/STAGE14_STAGE9_RUNTIME_CORE.sql; key tables/index/FK ada di kedua DB. |
| `20260926123133` | `stage14_staging_stage9_hardening` | efek Stage 9 hardening; tidak ada file salinan spesifik di master saat ini | **KHUSUS STAGING** | Entri berlabel Stage14 staging; trigger/validator tenant lama sudah tidak ada dan create_offer_activation sama antar-environment. Isi SQL historis spesifik tidak tersimpan, jadi bukan klaim byte-identical. |
| `20260926123139` | `stage14_staging_stage9_surface_cleanup` | efek Stage 9 surface cleanup; tidak ada file salinan spesifik di master saat ini | **KHUSUS STAGING** | Entri berlabel Stage14 staging; kedua RPC antrean usang tidak ada di kedua DB. Isi SQL historis spesifik tidak tersimpan, jadi bukan klaim byte-identical. |
| `20260926123146` | `stage14_staging_stage9_rate_limit_reconciliation` | supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql | **KHUSUS STAGING** | Executable copy used by the staging bootstrap; it already trims `p_scope`. The forward-only normalization migration was later applied to both environments, so production now has the same behavior. |
| `20260926123152` | `stage10_click_runtime` | supabase/migrations/20260925225318_stage_10_click_runtime.sql | **ALIAS/TIMESTAMP HISTORIS** | Stage 10 row uses compact legacy slug; it maps to canonical Stage 10 click runtime source, while version differs from source timestamp. |
| `20260926123202` | `stage12_qualified_click_runtime` | supabase/migrations/20260926030000_stage_12_qualified_click_runtime.sql | **ALIAS/TIMESTAMP HISTORIS** | Stage 12 row uses compact legacy slug; it maps to canonical qualified-click source, while version differs from source timestamp. |
| `20260926123209` | `stage13_atomic_settlement_runtime` | supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql | **ALIAS/TIMESTAMP HISTORIS** | Stage 13 row uses compact legacy slug; it maps to canonical atomic-settlement source, while version differs from source timestamp. |
| `20260926123215` | `stage13_settlement_index_cleanup` | supabase/migrations/20260926040500_stage_13_settlement_index_cleanup.sql | **ALIAS/TIMESTAMP HISTORIS** | Stage 13 row uses compact legacy slug; it maps to canonical settlement-index source, while version differs from source timestamp. |
| `20260926215632` | `stage14_make_credit_fixture_repeatable` | supabase/staging/STAGE14_SEED.sql | **KHUSUS STAGING** | Perubahan repeatability pada seed/credit fixture (commit 216baf5c); bukan migrasi produksi. |
| `20260927195821` | `stage_15_production_smoke_harness` | supabase/migrations/20260927195830_stage_15_production_smoke_harness.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260927195955` | `stage_15_transactional_production_smoke` | supabase/migrations/20260927200018_stage_15_transactional_production_smoke.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260927200213` | `stage_15_production_smoke_queue_isolation` | supabase/migrations/20260927200219_stage_15_production_smoke_queue_isolation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928110208` | `stage_16_activation_workspace_context` | supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928110226` | `stage_16_initial_workspace_creation` | supabase/migrations/20260928061500_stage_16_initial_workspace_creation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928110412` | `stage_16_v2_function_privilege_hardening` | supabase/migrations/20260928180000_stage_16_v2_function_privilege_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928110633` | `stage_16_private_table_deny_policies` | supabase/migrations/20260928180500_stage_16_private_table_deny_policies.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928112537` | `stage_16_v2_workspace_scope_qualification` | supabase/migrations/20260928183000_stage_16_v2_workspace_scope_qualification.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928112623` | `stage_16_v2_initial_workspace_context_fix` | supabase/migrations/20260928185000_stage_16_v2_initial_workspace_context_fix.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928134106` | `stage_16_first_workspace_rls_bootstrap` | supabase/migrations/20260928193000_stage_16_first_workspace_rls_bootstrap.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928140437` | `20260928194500_stage_16_first_workspace_insert_returning_rls` | supabase/migrations/20260928194500_stage_16_first_workspace_insert_returning_rls.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928163633` | `stage_16_atomic_integration_credential_provisioning` | supabase/migrations/20260928233000_stage_16_atomic_integration_credential_provisioning.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928170043` | `stage_16_private_credential_verification_boundary` | supabase/migrations/20260929000500_stage_16_private_credential_verification_boundary.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928180258` | `stage_16_read_only_control_plane` | supabase/migrations/20260929010000_stage_16_read_only_control_plane.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003013324` | `stage_17_remediation` | supabase/migrations/20261003000000_stage_17_remediation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003154220` | `stage_17_remediation` | supabase/migrations/20261003000000_stage_17_remediation.sql → supabase/migrations/20261003020000_stage_17_final_reconcile.sql | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Entri kedua bernama sama; final reconcile sesudahnya mengatur ulang keadaan akhir. Konten SQL terpisah untuk entri kedua tidak disimpan, sehingga tidak diperlakukan sebagai pasangan langsung. |
| `20261003154423` | `stage_17_smoke_verifier_fix` | supabase/migrations/20261003010000_stage_17_smoke_verifier_fix.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. Di produksi tidak ada entri mandiri, tetapi efek verifier dibawa oleh final reconcile dan terverifikasi live. |
| `20261003154641` | `stage_17_final_reconcile` | supabase/migrations/20261003020000_stage_17_final_reconcile.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003165532` | `h0_h1_runtime_hardening` | supabase/migrations/20261003230000_h0_h1_runtime_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003165631` | `h1_runtime_audit_fix` | supabase/migrations/20261003232000_h1_runtime_audit_fix.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003170423` | `h1_runtime_integrity_policy` | supabase/migrations/20261004001000_h1_runtime_integrity_policy.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003171420` | `h1_canary_exclusion` | supabase/migrations/20261004001500_h1_canary_exclusion.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003175300` | `h2_1_runtime_failure_containment` | supabase/migrations/20261004010000_h2_1_runtime_failure_containment.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003180823` | `h2_2_recovery_operations` | supabase/migrations/20261004020000_h2_2_recovery_operations.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003181343` | `h2_2_runtime_ops_hardening` | supabase/migrations/20261004021000_h2_2_runtime_ops_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003193248` | `h2_3_release_reliability_proof` | supabase/migrations/20261004030000_h2_3_release_reliability_proof.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003204406` | `20261004034037_h3_1_network_moment_model` | supabase/migrations/20261004034037_h3_1_network_moment_model.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003205357` | `20261004040300_h3_1_network_offer_validation` | supabase/migrations/20261004040300_h3_1_network_offer_validation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261010224151` | `stage_16_moment_key_semantics` | supabase/migrations/20261011010000_stage_16_moment_key_semantics.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011000951` | `h4_1_unsettled_settlement_recovery` | supabase/migrations/20261011020000_h4_1_unsettled_settlement_recovery.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011104135` | `h4_2_rpc_security_and_index_audit` | supabase/migrations/20261011105000_h4_2_rpc_security_and_index_audit.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011104443` | `h4_3_redundant_financial_index` | supabase/migrations/20261011110000_h4_3_redundant_financial_index.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011105247` | `h4_4_redundant_financial_accounts_index` | supabase/migrations/20261011120000_h4_4_redundant_financial_accounts_index.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261013135832` | `rate_limit_scope_normalization` | `supabase/migrations/20261013010000_rate_limit_scope_normalization.sql` | **ALIAS/TIMESTAMP HISTORIS — STAGING CANARY** | Migration API mencatat timestamp saat apply. SQL length 2378; MD5 `aab903f4a6318cf37defee52419e7488`. Bukan perubahan manual history. Production belum memiliki row ini. |
| `20261013142232` | `pgmq_service_role_usage_hardening` | `supabase/migrations/20261013130000_pgmq_service_role_usage_hardening.sql` | **ALIAS/TIMESTAMP HISTORIS** | Platform migration API mencatat `REVOKE USAGE ON SCHEMA pgmq FROM service_role;` (46 karakter; MD5 `3e25aaa99541f80c48e62c5ae033ec70`). |

## B. Semua history production

| Version | Name di history | Sumber / efek yang dipetakan | Status | Bukti / alasan |
|---|---|---|---|
| `20260925205217` | `stage_6_production_foundation` | supabase/migrations/20260925205217_stage_6_production_foundation.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925205428` | `stage_6_hardening` | supabase/migrations/20260925205428_stage_6_hardening.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925205723` | `stage_6_advisor_cleanup` | supabase/migrations/20260925205723_stage_6_advisor_cleanup.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925211435` | `stage_8_activation_foundation` | supabase/migrations/20260925211435_stage_8_activation_foundation.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925211519` | `stage_8_activation_foundation_hardening` | supabase/migrations/20260925211519_stage_8_activation_foundation_hardening.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925212247` | `stage_8_capability_enforcement` | supabase/migrations/20260925212247_stage_8_capability_enforcement.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925212601` | `stage_8_destination_url_compatibility` | supabase/migrations/20260925212601_stage_8_destination_url_compatibility.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925212930` | `stage_8_function_grant_hardening` | supabase/migrations/20260925212930_stage_8_function_grant_hardening.sql | **COCOK LANGSUNG** | Version cocok dengan timestamp source; nama adalah slug sumber tanpa ekstensi .sql. |
| `20260925214730` | `20260926030000_stage_9_runtime_core` | supabase/migrations/20260926030000_stage_9_runtime_core.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925215138` | `stage_9_runtime_reconciliation` | payload historis `statements` (6863 karakter; MD5 `c569bef7ebe625091da563a6435a2c45`) | **ALIAS/TIMESTAMP HISTORIS** | Memuat cleanup job `nextaction-runtime-events`, `DROP FUNCTION IF EXISTS public.runtime_drain_events(INTEGER)`, versi lama limiter, dan binding idempotency `runtime_accept_event`. Cleanup dibuktikan oleh state live (legacy job/function absen, worker resmi aktif); `runtime_accept_event` cocok dengan body live setelah normalisasi; limiter digantikan revisi berikutnya. |
| `20260925215209` | `stage_9_runtime_reconciliation` | payload historis `statements` (6808 karakter; MD5 `d0cf31c6d79cbe4dcc7ca8828c8b2ee1`) | **ALIAS/TIMESTAMP HISTORIS** | Revisi setelah versi `20260925215138`. Payload ini identik byte-for-byte dengan versi `20260925215231` meskipun nama berbeda; body `runtime_accept_event` cocok dengan live setelah normalisasi, sementara limiter lama digantikan revisi `stage_9_runtime_builtin_fix`. |
| `20260925215210` | `stage_9_hardening` | supabase/migrations/20260926040000_stage_9_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925215231` | `stage_9_runtime_hardening` | payload historis `statements` (6808 karakter; MD5 `d0cf31c6d79cbe4dcc7ca8828c8b2ee1`) | **ALIAS/TIMESTAMP HISTORIS** | SQL persis sama dengan row `20260925215209`, termasuk komentar header `Stage 9 runtime reconciliation`; duplicate/retry idempotent, bukan hardening terpisah. Jangan menghapus atau menulis ulang baris history. |
| `20260925215322` | `stage_9_runtime_sql_fix` | payload historis `statements` (8802 karakter; MD5 `9e3c0460b584421bbcf94823037e5213`); mendefinisikan `check_runtime_rate_limit`, `runtime_accept_event`, `runtime_process_event` | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | `runtime_process_event` cocok dengan `20260926030000_stage_9_runtime_core.sql`; `runtime_accept_event` cocok dengan body live setelah normalisasi. Versi limiter pada payload ini diganti oleh revisi berikutnya `stage_9_runtime_builtin_fix`, jadi tidak perlu direplay. |
| `20260925215343` | `stage_9_runtime_builtin_fix` | payload historis `statements` (8780 karakter; MD5 `ce03829ef844d117c612b630416a7560`); mendefinisikan tiga fungsi runtime | **ALIAS/TIMESTAMP HISTORIS** | Ketiga function bodies cocok dengan production live setelah normalisasi whitespace/kualifikasi SQL. `runtime_process_event` dipetakan ke Stage 9 core, `runtime_accept_event` ke Stage 9 hardening, dan limiter ke rate-limit reconciliation. Drift aktif: nilai INSERT scope di payload/live adalah `p_scope` mentah, sedangkan source kanonis menyimpan `pg_catalog.btrim(p_scope)`. |
| `20260925215416` | `stage_9_decision_runtime_hardening` | payload historis `statements` (4865 karakter; MD5 `a793f56d1c8573114166afc105360f55`) | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Payload membuat versi awal `runtime_create_decision_delivery`. Body live (6866 karakter, MD5 `613b596c3348b8fcf346163e2b7dec85`) cocok setelah normalisasi dengan `20261004034037_h3_1_network_moment_model.sql`; fungsi legacy tidak perlu direplay. |
| `20260925215802` | `stage_9_runtime_surface_cleanup` | supabase/migrations/20260926044000_stage_9_runtime_surface_cleanup.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925225318` | `stage_10_click_runtime` | supabase/migrations/20260925225318_stage_10_click_runtime.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260925231337` | `20260926030000_stage_12_qualified_click_runtime` | supabase/migrations/20260926030000_stage_12_qualified_click_runtime.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925232043` | `20260926040000_stage_13_atomic_settlement_runtime` | supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925232130` | `20260926040500_stage_13_settlement_index_cleanup` | supabase/migrations/20260926040500_stage_13_settlement_index_cleanup.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260927195830` | `stage_15_production_smoke_harness` | supabase/migrations/20260927195830_stage_15_production_smoke_harness.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260927200018` | `stage_15_transactional_production_smoke` | supabase/migrations/20260927200018_stage_15_transactional_production_smoke.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260927200219` | `stage_15_production_smoke_queue_isolation` | supabase/migrations/20260927200219_stage_15_production_smoke_queue_isolation.sql | **COCOK LANGSUNG** | Versi history sama dengan prefix timestamp sumber; nama adalah slug sumber (ekstensi .sql dapat tidak disimpan). |
| `20260928155752` | `stage_16_activation_workspace_context.sql` | supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155758` | `stage_16_initial_workspace_creation.sql` | supabase/migrations/20260928061500_stage_16_initial_workspace_creation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155805` | `stage_16_v2_function_privilege_hardening.sql` | supabase/migrations/20260928180000_stage_16_v2_function_privilege_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155814` | `stage_16_private_table_deny_policies.sql` | supabase/migrations/20260928180500_stage_16_private_table_deny_policies.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155820` | `stage_16_v2_workspace_scope_qualification.sql` | supabase/migrations/20260928183000_stage_16_v2_workspace_scope_qualification.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155829` | `stage_16_v2_initial_workspace_context_fix.sql` | supabase/migrations/20260928185000_stage_16_v2_initial_workspace_context_fix.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155835` | `stage_16_first_workspace_rls_bootstrap.sql` | supabase/migrations/20260928193000_stage_16_first_workspace_rls_bootstrap.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928155842` | `stage_16_first_workspace_insert_returning_rls.sql` | supabase/migrations/20260928194500_stage_16_first_workspace_insert_returning_rls.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928165116` | `stage_16_atomic_integration_credential_provisioning` | supabase/migrations/20260928233000_stage_16_atomic_integration_credential_provisioning.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260928171331` | `stage_16_private_credential_verification_boundary` | supabase/migrations/20260929000500_stage_16_private_credential_verification_boundary.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260929090426` | `stage_16_read_only_control_plane` | supabase/migrations/20260929010000_stage_16_read_only_control_plane.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003013723` | `stage_17_remediation` | supabase/migrations/20261003000000_stage_17_remediation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003154650` | `stage_17_final_reconcile` | supabase/migrations/20261003020000_stage_17_final_reconcile.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. Ini juga membawa perbaikan verifier; ORDER BY clicked_at DESC, id DESC terverifikasi pada kedua DB. |
| `20261003165724` | `h0_h1_runtime_hardening` | supabase/migrations/20261003230000_h0_h1_runtime_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003165730` | `h1_runtime_audit_fix` | supabase/migrations/20261003232000_h1_runtime_audit_fix.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003170415` | `h1_runtime_integrity_policy` | supabase/migrations/20261004001000_h1_runtime_integrity_policy.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003171414` | `h1_canary_exclusion` | supabase/migrations/20261004001500_h1_canary_exclusion.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003175812` | `h2_1_runtime_failure_containment` | supabase/migrations/20261004010000_h2_1_runtime_failure_containment.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003182724` | `h2_2_recovery_operations` | supabase/migrations/20261004020000_h2_2_recovery_operations.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003182730` | `h2_2_runtime_ops_hardening` | supabase/migrations/20261004021000_h2_2_runtime_ops_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003193255` | `h2_3_release_reliability_proof` | supabase/migrations/20261004030000_h2_3_release_reliability_proof.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003210738` | `h3_1_network_moment_model` | supabase/migrations/20261004034037_h3_1_network_moment_model.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261003210746` | `h3_1_network_offer_validation` | supabase/migrations/20261004040300_h3_1_network_offer_validation.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011001038` | `stage_16_moment_key_semantics` | supabase/migrations/20261011010000_stage_16_moment_key_semantics.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011001052` | `h4_1_unsettled_settlement_recovery` | supabase/migrations/20261011020000_h4_1_unsettled_settlement_recovery.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011104950` | `h4_2_rpc_security_and_index_audit` | supabase/migrations/20261011105000_h4_2_rpc_security_and_index_audit.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011105000` | `h4_3_redundant_financial_index` | supabase/migrations/20261011110000_h4_3_redundant_financial_index.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261011105817` | `h4_4_redundant_financial_accounts_index` | supabase/migrations/20261011120000_h4_4_redundant_financial_accounts_index.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20261013141041` | `rate_limit_scope_normalization` | `supabase/migrations/20261013010000_rate_limit_scope_normalization.sql` | **ALIAS/TIMESTAMP HISTORIS — PRODUCTION ROLLOUT** | Migration API mencatat timestamp aktual saat apply; SQL length 2378, MD5 `aab903f4a6318cf37defee52419e7488`. Tidak ada perubahan manual history. |
| `20261013142338` | `pgmq_service_role_usage_hardening` | `supabase/migrations/20261013130000_pgmq_service_role_usage_hardening.sql` | **ALIAS/TIMESTAMP HISTORIS** | Platform migration API mencatat `REVOKE USAGE ON SCHEMA pgmq FROM service_role;` (46 karakter; MD5 `3e25aaa99541f80c48e62c5ae033ec70`). |

## C. Manifest semua file sumber di master

Setiap file kanonis di bawah masuk inventaris. Untuk sumber yang tidak mempunyai history row yang unik di production, hal itu ditandai secara eksplisit; keberadaan file di master bukan klaim bahwa migrasi sudah dijalankan ke kedua hosted database.

| File sumber | Blob SHA (12 karakter) | Mapping staging | Mapping production / gap |
|---|---|---|---|
| `supabase/migrations/20260925205217_stage_6_production_foundation.sql` | `75155ac7648b` | ALIAS/TIMESTAMP HISTORIS (20260926122939) | COCOK LANGSUNG (20260925205217) |
| `supabase/migrations/20260925205428_stage_6_hardening.sql` | `32cf0fe57853` | ALIAS/TIMESTAMP HISTORIS (20260926122946) | COCOK LANGSUNG (20260925205428) |
| `supabase/migrations/20260925205723_stage_6_advisor_cleanup.sql` | `57c29ad3b979` | ALIAS/TIMESTAMP HISTORIS (20260926122952) | COCOK LANGSUNG (20260925205723) |
| `supabase/migrations/20260925211435_stage_8_activation_foundation.sql` | `a3278a49f8ea` | ALIAS/TIMESTAMP HISTORIS (20260926122959) | COCOK LANGSUNG (20260925211435) |
| `supabase/migrations/20260925211519_stage_8_activation_foundation_hardening.sql` | `4247c95ea130` | ALIAS/TIMESTAMP HISTORIS (20260926123006) | COCOK LANGSUNG (20260925211519) |
| `supabase/migrations/20260925212247_stage_8_capability_enforcement.sql` | `dca632c92c92` | ALIAS/TIMESTAMP HISTORIS (20260926123013) | COCOK LANGSUNG (20260925212247) |
| `supabase/migrations/20260925212601_stage_8_destination_url_compatibility.sql` | `0bfcc7d2b84d` | ALIAS/TIMESTAMP HISTORIS (20260926123019) | COCOK LANGSUNG (20260925212601) |
| `supabase/migrations/20260925212930_stage_8_function_grant_hardening.sql` | `b2fec4a26523` | ALIAS/TIMESTAMP HISTORIS (20260926123026) | COCOK LANGSUNG (20260925212930) |
| `supabase/migrations/20260925225318_stage_10_click_runtime.sql` | `432857bc0580` | ALIAS/TIMESTAMP HISTORIS (20260926123152) | COCOK LANGSUNG (20260925225318) |
| `supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql` | `34f6acc7a5a2` | ALIAS/TIMESTAMP HISTORIS — row 20260926123033 | EFEK DIGANTIKAN MIGRASI LEBIH BARU — tidak ada row mandiri; grant final oleh 20260929010000_stage_16_read_only_control_plane.sql |
| `supabase/migrations/20260926030000_stage_12_qualified_click_runtime.sql` | `50465e5f9daa` | ALIAS/TIMESTAMP HISTORIS (20260926123202) | ALIAS/TIMESTAMP HISTORIS (20260925231337) |
| `supabase/migrations/20260926030000_stage_9_runtime_core.sql` | `4eebbc547ef9` | KHUSUS STAGING — executable copy STAGE14_STAGE9_RUNTIME_CORE.sql | ALIAS/TIMESTAMP HISTORIS — 20260925214730 |
| `supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql` | `16757a84d59f` | ALIAS/TIMESTAMP HISTORIS (20260926123209) | ALIAS/TIMESTAMP HISTORIS (20260925232043) |
| `supabase/migrations/20260926040000_stage_9_hardening.sql` | `7575142dba7b` | KHUSUS STAGING — stage14_staging_stage9_hardening | ALIAS/TIMESTAMP HISTORIS — 20260925215210 |
| `supabase/migrations/20260926040500_stage_13_settlement_index_cleanup.sql` | `8e49558349dd` | ALIAS/TIMESTAMP HISTORIS (20260926123215) | ALIAS/TIMESTAMP HISTORIS (20260925232130) |
| `supabase/migrations/20260926044000_stage_9_runtime_surface_cleanup.sql` | `6ec1b6563d9d` | KHUSUS STAGING — stage14_staging_stage9_surface_cleanup | ALIAS/TIMESTAMP HISTORIS — 20260925215802 |
| `supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql` | `b5c0cb5a361a` | Stage 14 staging copy, canonical function body | Alias/timestamp history pada production lama sudah direkonsiliasi lewat `20261013141041 / rate_limit_scope_normalization`; staging/production kini sama pada normalisasi scope, hash `cbf7a36dae79fa63fd6287a5b1b73278` |
| `supabase/migrations/20260927195830_stage_15_production_smoke_harness.sql` | `a9c09e3f4b74` | ALIAS/TIMESTAMP HISTORIS (20260927195821) | COCOK LANGSUNG (20260927195830) |
| `supabase/migrations/20260927200018_stage_15_transactional_production_smoke.sql` | `025bec5a82b0` | ALIAS/TIMESTAMP HISTORIS (20260927195955) | COCOK LANGSUNG (20260927200018) |
| `supabase/migrations/20260927200219_stage_15_production_smoke_queue_isolation.sql` | `17569aaf3184` | ALIAS/TIMESTAMP HISTORIS (20260927200213) | COCOK LANGSUNG (20260927200219) |
| `supabase/migrations/20260928053000_stage_16_activation_workspace_context.sql` | `c0ba82195ccc` | ALIAS/TIMESTAMP HISTORIS (20260928110208) | ALIAS/TIMESTAMP HISTORIS (20260928155752) |
| `supabase/migrations/20260928061500_stage_16_initial_workspace_creation.sql` | `e3cba5dd3e3f` | ALIAS/TIMESTAMP HISTORIS (20260928110226) | ALIAS/TIMESTAMP HISTORIS (20260928155758) |
| `supabase/migrations/20260928180000_stage_16_v2_function_privilege_hardening.sql` | `dcaa5c4a0334` | ALIAS/TIMESTAMP HISTORIS (20260928110412) | ALIAS/TIMESTAMP HISTORIS (20260928155805) |
| `supabase/migrations/20260928180500_stage_16_private_table_deny_policies.sql` | `4dd53fd4f082` | ALIAS/TIMESTAMP HISTORIS (20260928110633) | ALIAS/TIMESTAMP HISTORIS (20260928155814) |
| `supabase/migrations/20260928183000_stage_16_v2_workspace_scope_qualification.sql` | `dbaf8be9451d` | ALIAS/TIMESTAMP HISTORIS (20260928112537) | ALIAS/TIMESTAMP HISTORIS (20260928155820) |
| `supabase/migrations/20260928185000_stage_16_v2_initial_workspace_context_fix.sql` | `bb72260bd15c` | ALIAS/TIMESTAMP HISTORIS (20260928112623) | ALIAS/TIMESTAMP HISTORIS (20260928155829) |
| `supabase/migrations/20260928193000_stage_16_first_workspace_rls_bootstrap.sql` | `45d623c83d5e` | ALIAS/TIMESTAMP HISTORIS (20260928134106) | ALIAS/TIMESTAMP HISTORIS (20260928155835) |
| `supabase/migrations/20260928194500_stage_16_first_workspace_insert_returning_rls.sql` | `9b4ebbe8a9cf` | ALIAS/TIMESTAMP HISTORIS (20260928140437) | ALIAS/TIMESTAMP HISTORIS (20260928155842) |
| `supabase/migrations/20260928233000_stage_16_atomic_integration_credential_provisioning.sql` | `7136218c91de` | ALIAS/TIMESTAMP HISTORIS (20260928163633) | ALIAS/TIMESTAMP HISTORIS (20260928165116) |
| `supabase/migrations/20260929000500_stage_16_private_credential_verification_boundary.sql` | `8053b884987a` | ALIAS/TIMESTAMP HISTORIS (20260928170043) | ALIAS/TIMESTAMP HISTORIS (20260928171331) |
| `supabase/migrations/20260929010000_stage_16_read_only_control_plane.sql` | `6eeb7dd13ef7` | ALIAS/TIMESTAMP HISTORIS (20260928180258) | ALIAS/TIMESTAMP HISTORIS (20260929090426) |
| `supabase/migrations/20261003000000_stage_17_remediation.sql` | `43a3a75c2580` | ALIAS/TIMESTAMP HISTORIS (20261003013324) | ALIAS/TIMESTAMP HISTORIS (20261003013723) |
| `supabase/migrations/20261003010000_stage_17_smoke_verifier_fix.sql` | `69d161bcbafc` | ALIAS/TIMESTAMP HISTORIS — 20261003154423 | EFEK DIGANTIKAN MIGRASI LEBIH BARU — tidak ada row standalone; final reconcile membawa ORDER BY c.clicked_at DESC, c.id DESC |
| `supabase/migrations/20261003020000_stage_17_final_reconcile.sql` | `0c22dd8b67a8` | ALIAS/TIMESTAMP HISTORIS (20261003154641) | ALIAS/TIMESTAMP HISTORIS (20261003154650) |
| `supabase/migrations/20261003230000_h0_h1_runtime_hardening.sql` | `baf78b93bf35` | ALIAS/TIMESTAMP HISTORIS (20261003165532) | ALIAS/TIMESTAMP HISTORIS (20261003165724) |
| `supabase/migrations/20261003232000_h1_runtime_audit_fix.sql` | `ca6d6f6f6fb6` | ALIAS/TIMESTAMP HISTORIS (20261003165631) | ALIAS/TIMESTAMP HISTORIS (20261003165730) |
| `supabase/migrations/20261004001000_h1_runtime_integrity_policy.sql` | `45099884c7da` | ALIAS/TIMESTAMP HISTORIS (20261003170423) | ALIAS/TIMESTAMP HISTORIS (20261003170415) |
| `supabase/migrations/20261004001500_h1_canary_exclusion.sql` | `89e861443311` | ALIAS/TIMESTAMP HISTORIS (20261003171420) | ALIAS/TIMESTAMP HISTORIS (20261003171414) |
| `supabase/migrations/20261004010000_h2_1_runtime_failure_containment.sql` | `0910c8393d1f` | ALIAS/TIMESTAMP HISTORIS (20261003175300) | ALIAS/TIMESTAMP HISTORIS (20261003175812) |
| `supabase/migrations/20261004020000_h2_2_recovery_operations.sql` | `b4af6e91b0f2` | ALIAS/TIMESTAMP HISTORIS (20261003180823) | ALIAS/TIMESTAMP HISTORIS (20261003182724) |
| `supabase/migrations/20261004021000_h2_2_runtime_ops_hardening.sql` | `0a68002cbeba` | ALIAS/TIMESTAMP HISTORIS (20261003181343) | ALIAS/TIMESTAMP HISTORIS (20261003182730) |
| `supabase/migrations/20261004030000_h2_3_release_reliability_proof.sql` | `1e3e5b2a9efd` | ALIAS/TIMESTAMP HISTORIS (20261003193248) | ALIAS/TIMESTAMP HISTORIS (20261003193255) |
| `supabase/migrations/20261004034037_h3_1_network_moment_model.sql` | `cce40e6b0e5b` | ALIAS/TIMESTAMP HISTORIS (20261003204406) | ALIAS/TIMESTAMP HISTORIS (20261003210738) |
| `supabase/migrations/20261004040300_h3_1_network_offer_validation.sql` | `ef692d050838` | ALIAS/TIMESTAMP HISTORIS (20261003205357) | ALIAS/TIMESTAMP HISTORIS (20261003210746) |
| `supabase/migrations/20261011010000_stage_16_moment_key_semantics.sql` | `d4e4c9111aef` | ALIAS/TIMESTAMP HISTORIS (20261010224151) | ALIAS/TIMESTAMP HISTORIS (20261011001038) |
| `supabase/migrations/20261011020000_h4_1_unsettled_settlement_recovery.sql` | `aeb5a1a3ee5e` | ALIAS/TIMESTAMP HISTORIS (20261011000951) | ALIAS/TIMESTAMP HISTORIS (20261011001052) |
| `supabase/migrations/20261011105000_h4_2_rpc_security_and_index_audit.sql` | `bae1511e1408` | ALIAS/TIMESTAMP HISTORIS (20261011104135) | ALIAS/TIMESTAMP HISTORIS (20261011104950) |
| `supabase/migrations/20261011110000_h4_3_redundant_financial_index.sql` | `2efba40144b7` | ALIAS/TIMESTAMP HISTORIS (20261011104443) | ALIAS/TIMESTAMP HISTORIS (20261011105000) |
| `supabase/migrations/20261011120000_h4_4_redundant_financial_accounts_index.sql` | `b73afc3bc601` | ALIAS/TIMESTAMP HISTORIS (20261011105247) | ALIAS/TIMESTAMP HISTORIS (20261011105817) |
| `supabase/migrations/20261013010000_rate_limit_scope_normalization.sql` | `e8cf75965012` | APPLIED AS ALIAS/TIMESTAMP HISTORIS: staging `20261013135832 / rate_limit_scope_normalization`; SQL MD5 `aab903f4a6318cf37defee52419e7488` | APPLIED AS ALIAS/TIMESTAMP HISTORIS: production `20261013141041 / rate_limit_scope_normalization`; same canonical SQL payload; row recorded by official migration API |
| `supabase/migrations/20261013130000_pgmq_service_role_usage_hardening.sql` | `9d846dcb9c9a` | Applied as alias/timestamp history: staging `20261013142232 / pgmq_service_role_usage_hardening` | Applied as alias/timestamp history: production `20261013142338 / pgmq_service_role_usage_hardening`; same SQL payload MD5 `3e25aaa99541f80c48e62c5ae033ec70` |

## D. Blocker lineage yang tersisa dan tindakan aman

### D1. Payload SQL legacy Stage 9 dipulihkan dan dibandingkan

Kolom `statements` di `supabase_migrations.schema_migrations` dipulihkan secara SELECT-only. Fingerprint berikut dihitung sebagai `md5(array_to_string(statements, E'\\n'))`; masing-masing row memiliki satu statement SQL. Data ini juga cocok dengan panjang dan MD5 pada manifest statement-level 11 Oktober.

| Version | Name | Status | Payload dan pemetaan efek |
|---|---|---|---|
| `20260925215138` | `stage_9_runtime_reconciliation` | **ALIAS/TIMESTAMP HISTORIS** | 6863 karakter; MD5 `c569bef7ebe625091da563a6435a2c45`. Memuat cleanup job `nextaction-runtime-events`, penghapusan `runtime_drain_events`, versi lama `check_runtime_rate_limit`, dan `runtime_accept_event` dengan idempotency payload binding. Legacy job/function absen dari katalog live; `runtime_accept_event` cocok setelah normalisasi. |
| `20260925215209` | `stage_9_runtime_reconciliation` | **ALIAS/TIMESTAMP HISTORIS** | 6808 karakter; MD5 `d0cf31c6d79cbe4dcc7ca8828c8b2ee1`. Revisi berikutnya; payload identik dengan row `20260925215231`. |
| `20260925215231` | `stage_9_runtime_hardening` | **ALIAS/TIMESTAMP HISTORIS** | 6808 karakter; MD5 `d0cf31c6d79cbe4dcc7ca8828c8b2ee1`. Payload identik byte-for-byte dengan row `20260925215209`, meskipun nama berbeda. Diklasifikasikan sebagai duplicate/retry idempotent, bukan source DDL yang harus direplay. |
| `20260925215322` | `stage_9_runtime_sql_fix` | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | 8802 karakter; MD5 `9e3c0460b584421bbcf94823037e5213`. Tiga fungsi. `runtime_process_event` cocok dengan Stage 9 core; fungsi limiter digantikan koreksi built-in selanjutnya; `runtime_accept_event` cocok dengan body live setelah normalisasi. |
| `20260925215343` | `stage_9_runtime_builtin_fix` | **ALIAS/TIMESTAMP HISTORIS** | 8780 karakter; MD5 `ce03829ef844d117c612b630416a7560`. Body tiga fungsi cocok dengan production live setelah normalisasi. Pemetaan sumber adalah Stage 9 core (`runtime_process_event`), Stage 9 hardening (`runtime_accept_event`), dan rate-limit reconciliation (`check_runtime_rate_limit`). Nilai INSERT scope mentah tetap drift aktif. |
| `20260925215416` | `stage_9_decision_runtime_hardening` | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | 4865 karakter; MD5 `a793f56d1c8573114166afc105360f55`. Versi awal `runtime_create_decision_delivery` digantikan oleh `20261004034037_h3_1_network_moment_model.sql`; definisi deployed cocok setelah normalisasi (body length 6866, MD5 `613b596c3348b8fcf346163e2b7dec85`). |

Kesimpulan payload: keenam row legacy kini mempunyai status yang dapat dipertanggungjawabkan; **tidak ada history row production yang berstatus BELUM TERJELASKAN**. Ini bukan dasar untuk menghapus, menulis ulang, atau menggabungkan baris history. Fingerprint membuktikan SQL yang tercatat dan perbandingan body membuktikan efek yang masih berlaku atau telah digantikan; file-file canonical tetap merupakan source untuk clean replay.

### D2. Scope normalization applied and verified in staging and production

The canonical forward-only migration `20261013010000_rate_limit_scope_normalization.sql` has now been applied through the official Supabase migration API in both environments. The tool recorded environment-generated history versions rather than reusing the source filename timestamp:

| Environment | Recorded version | History name | SQL length | SQL MD5 |
|---|---|---|---:|---|
| Staging | `20261013135832` | `rate_limit_scope_normalization` | 2378 | `aab903f4a6318cf37defee52419e7488` |
| Production | `20261013141041` | `rate_limit_scope_normalization` | 2378 | `aab903f4a6318cf37defee52419e7488` |

These are aliases/timestamp drift in the remote ledger; the canonical Git source remains `20261013010000_rate_limit_scope_normalization.sql`. No existing `schema_migrations` row was edited.

**Post-apply verification: PASS in both environments.** Both hosted histories have **54 rows**. `public.check_runtime_rate_limit` has body MD5 `cbf7a36dae79fa63fd6287a5b1b73278`, persists `pg_catalog.btrim(p_scope)`, and EXECUTE is false for `anon` and `authenticated` and true for `service_role`. A transaction-scoped regression was run in both environments with `SET LOCAL ROLE service_role`: padded then canonical scope returned counts 1 then 2, one bucket total; `ROLLBACK` removed every synthetic write. Production rate-limit scope drift is closed.

The exploratory CLI canary [run 38408365426](https://github.com/fsoeltonione/nextaction/actions/runs/38408365426) stopped before DB connection because the GitHub environment secrets were empty; it did not apply anything and its temporary workflow was removed. The persistent migration API applies are recorded separately above. No `schema_migrations` row was manually edited.
### D3. PGMQ schema privilege hardening applied and verified

The forward-only source [`20261013130000_pgmq_service_role_usage_hardening.sql`](https://github.com/fsoeltonione/nextaction/blob/master/supabase/migrations/20261013130000_pgmq_service_role_usage_hardening.sql) revokes only direct `USAGE` on schema `pgmq` from `service_role`; runtime calls remain behind `SECURITY DEFINER` RPCs with empty `search_path`.

| Environment | Recorded version | History name | SQL length | SQL MD5 |
|---|---|---|---:|---|
| Staging | `20261013142232` | `pgmq_service_role_usage_hardening` | 46 | `3e25aaa99541f80c48e62c5ae033ec70` |
| Production | `20261013142338` | `pgmq_service_role_usage_hardening` | 46 | `3e25aaa99541f80c48e62c5ae033ec70` |

Read-only verification confirms `has_schema_privilege('service_role','pgmq','USAGE') = false` in both environments. `public.runtime_readiness()` is `SECURITY DEFINER`, pins an empty `search_path`, and remains executable by `service_role`. Called inside a transaction after `SET LOCAL ROLE service_role`, it returned `status=ready` in both staging and production; queue exists, worker/operations schedules are active, and their latest runs were successful. Separately, the 13 critical RPCs passed all **78/78** SELECT-only contract checks in each environment: existence, `SECURITY DEFINER`, empty `search_path`, anon/authenticated EXECUTE denied, and service_role EXECUTE granted. No data-changing test was used for this RPC check.

The source change was merged by [PR #138](https://github.com/fsoeltonione/nextaction/pull/138) at commit `1d058c40456e483ddb585bf9683100113e2549b0`; disposable migration replay [run 38412080047](https://github.com/fsoeltonione/nextaction/actions/runs/38412080047) and quality CI [run 38412080083](https://github.com/fsoeltonione/nextaction/actions/runs/38412080083) passed. The two environment history versions differ from the source filename timestamp because the official migration API assigns platform versions; retain that mapping and do not edit existing history rows.
### D4. Legacy Stage 8 grant dan Stage 17 verifier sudah digantikan

- `20260926010000_stage_8_function_grant_hardening.sql`: tidak ada baris history mandiri di production, tetapi efek grant yang tepat telah digantikan oleh `20260929010000_stage_16_read_only_control_plane.sql`. Jangan reapply grant lama yang akan memberikan kembali `authenticated` execute.
- `20261003010000_stage_17_smoke_verifier_fix.sql`: tidak ada history mandiri di production, namun `20261003020000_stage_17_final_reconcile.sql` membawa correction yang sekarang terverifikasi pada kedua DB. Tidak perlu backfill history hanya untuk meniru staging.
- Dua nama history `stage14_staging_*` adalah jalur executable staging / alias untuk salinan staging; `stage14_staging_bootstrap` dan fixture seed bukan migrasi production. Fixture auth staging yang tertinggal telah dicatat di atas; jangan menghapusnya tanpa menilai efek pada smoke/fixture berikutnya.

### D5. Review semantik function/catalog diffs dan keputusan tersisa

Diff token-aware sudah dilakukan pada enam function yang hash-nya berbeda. Hasilnya bukan enam behavior drift:

- `public.confirm_product_activation` dan `public.runtime_readiness`: token SQL sama setelah whitespace/comment normalization; ini perbedaan formatting/line-wrap.
- `public.resolve_runtime_integration`: selisih hanya alias nama `workspace_capabilities` (`wc`) versus fully-qualified table reference; efeknya ekuivalen.
- `public.runtime_worker_tick`: staging mempunyai deklarasi lokal `v_now TIMESTAMPTZ` yang tidak dipakai; production tidak punya deklarasi itu. Tidak mengubah flow.
- `public.runtime_accept_event`: staging memakai `btrim`, production memakai `trim` untuk normalisasi idempotency key/event type. Query langsung pada kedua environment menunjukkan default trim dan btrim menghasilkan nilai setara pada input spasi/tab yang diuji. Pattern allowlist juga menolak key/event type yang dipadding sebelum trimming. Ini belum memerlukan perbaikan behavior terpisah; canonical staging body tetap dipertahankan.
- `private.runtime_quarantine_message`: staging secara eksplisit memasukkan `last_seen_at = timezone('utc', now())` lalu mengambilnya dari `EXCLUDED`; production mengandalkan default kolom yang sama dan meng-update ke `timezone('utc', now())`. Catalog membuktikan default `last_seen_at` sama antar-env, jadi selisih itu ekuivalen di bawah semantik `now()` transaction timestamp.

Dua perbedaan katalog yang perlu keputusan terpisah:

1. **Grant schema `pgmq` — delta sudah ditutup.** Direct `USAGE` is absent in staging and production. The `runtime_readiness()` SECURITY DEFINER RPC was called as `service_role` in each environment after revocation and returned `ready`; pgTAP coverage for this path passed in disposable migration replay.
2. **UUID defaults — beda deklarasi, tidak terbukti beda output kontrak.** Staging memakai `extensions.gen_random_uuid()` pada lima kolom awal, sementara production memakai built-in `gen_random_uuid()` (`pg_catalog`) pada empat kolom di antaranya. Staging juga menggunakan extension function untuk `private.runtime_integrity_snapshots.id` di keduanya. Kedua implementasi adalah UUID-v4 generators; perbedaan ini bukan blocker fungsi aplikasi yang sudah dibuktikan. Jangan mengubah default columns tanpa migration terpisah atau kebutuhan yang jelas.

Kesimpulan: scope-normalization dan pencabutan direct `pgmq` USAGE sudah diterapkan di kedua environment. Keenam payload legacy Stage 9 telah dipetakan. Sisa perbedaan katalog yang belum menjadi bukti behavior defect adalah UUID-default qualification; perbedaan tersebut tetap dicatat tanpa perubahan skema.
## F. Inventaris script pendukung di `supabase/staging/`

Script di direktori ini bukan bagian dari 51 file migrasi kanonis

| File | Jenis | Hubungan ke history / source | Status | Batas bukti |
|---|---|---|---|---|
| `supabase/staging/STAGE14_BOOTSTRAP.sql` | Bootstrap kompatibilitas staging | Row `20260926122918 / stage14_staging_bootstrap` | **KHUSUS STAGING** | Fixture auth `stage14-smoke@nextaction.invalid` tersisa di staging; tidak ada di production. Tidak ada relasi `public.stage14_*` yang tertinggal. |
| `supabase/staging/STAGE14_RESET.sql` | Utility reset fixture disposable | Tidak ditemukan sebagai row migration mandiri | **KHUSUS STAGING** | Tidak dijalankan saat audit. Skrip ini dapat menghapus fixture/menonaktifkan trigger dalam transaksi; jangan jalankan sebagai langkah rekonsiliasi history. |
| `supabase/staging/STAGE14_SEED.sql` | Fixture publisher/advertiser & credit | Berkaitan dengan row `20260926215632 / stage14_make_credit_fixture_repeatable`; riwayat commit perubahan fixture `216baf5c` | **KHUSUS STAGING** | Ini seed/fixture, bukan source DDL production. Tidak ada `public.stage14_seed_output` yang tertinggal pada snapshot. |
| `supabase/staging/STAGE14_STAGE9_RUNTIME_CORE.sql` | Executable copy untuk bootstrap staging | Row `20260926123123 / stage14_staging_stage9_runtime_core`; salinan kanonis Stage 9 Runtime Core | **KHUSUS STAGING** | File secara eksplisit menjelaskan salinan ini dibuat karena sintaks khusus SQL pada sumber historis perlu diperbaiki untuk eksekusi staging. Objek inti terkait diverifikasi di kedua DB. |
| `supabase/staging/STAGE14_STAGE9_RATE_LIMIT_RECONCILIATION.sql` | Executable copy rate-limit reconciliation | Row `20260926123146 / stage14_staging_stage9_rate_limit_reconciliation` | **KHUSUS STAGING** | This sidecar has `btrim(p_scope)`. After the forward-only migration, production now has matching scope-normalization semantics. |

Dua history row `stage14_staging_stage9_hardening` dan `stage14_staging_stage9_surface_cleanup` tidak mempunyai file copy masing-masing di folder staging pada master saat ini. Efek akhir yang relevan telah diverifikasi pada katalog, namun SQL historis per baris tidak tersedia; status `KHUSUS STAGING` pada ledger menyatakan jalur/lingkup entry tersebut, bukan jaminan kesamaan isi SQL byte-for-byte. Bila SQL aslinya ditemukan dalam artefak lama, tambahkan provenance/hash ke ledger tanpa mengubah history DB.

## E. Gerbang selesai yang direkomendasikan

**Status database hardening: PASS untuk scope normalization dan PGMQ privilege boundary. Status MVP release: HOLD sampai route-level acceptance selesai.**

1. Readiness check pasca-hardening berhasil di kedua env saat dipanggil sebagai `service_role`: status `ready`, queue `runtime-events` ada, worker dan operations cron aktif serta baru sukses. History staging dan production masing-masing 54 baris; dua migrasi baru tercatat sebagai alias/timestamp yang dibuat oleh migration API. Jangan mengubah history lama secara manual.
2. Langkah produk berikutnya adalah menjalankan **Release Gate `workflow_dispatch` dengan `release_target=staging`** di [`.github/workflows/release.yml`](https://github.com/fsoeltonione/nextaction/blob/master/.github/workflows/release.yml). Pipeline menjalankan staging smoke, H3.1 release proof/runtime smoke, anonymous embed-first acceptance, dan authenticated staging acceptance. Canari CLI percobaan yang berhenti karena secret kosong tidak sama dengan release gate ini dan tidak mengubah DB.
3. Setelah staging workflow lulus, verifikasi alur bisnis inti Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement, termasuk idempotent replay dan settlement exactly-once/ledger integrity.
4. Baru setelah bukti staging tersebut lulus, buka rollout production sebagai keputusan terpisah dengan baseline sebelum perubahan serta verifikasi sesudahnya. Tidak ada production deployment baru yang diusulkan oleh dokumen audit ini.
5. Simpan manifest lineage, source commit, recorded history versions, SQL length/MD5, dan post-deployment proof dalam ledger; jangan mengubah, menghapus, atau menggabungkan `schema_migrations` rows.
