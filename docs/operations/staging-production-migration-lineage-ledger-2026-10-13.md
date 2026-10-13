# Staging/Production Migration Lineage Ledger — 2026-10-13

## Keputusan gerbang produksi

**STATUS: HOLD — jangan deploy migrasi baru ke database produksi.** Inventaris lengkap berhasil ditangkap, dan sebagian besar riwayat dapat dipetakan sebagai alias/timestamp historis atau efek yang sudah digantikan. Namun ada dua baris legacy produksi bernama `stage_9_runtime_reconciliation` yang tidak memiliki SQL sumber tersimpan atau pasangan unik di repo saat ini; provenance setiap baris tidak dapat dibuktikan. Selain itu, migrasi rate-limit kanonis tidak memiliki pasangan history produksi yang unik dan fungsi live produksi masih menyimpan `p_scope` tanpa normalisasi. Ini bukan kegagalan CI; ini celah lineage + drift aktual yang harus dipertahankan sebagai blocker.

Audit dilakukan secara read-only pada kedua database Supabase. Tidak ada migrasi yang dijalankan, tidak ada data yang diubah, dan tidak ada baris `schema_migrations` yang diedit. Tidak ada upaya membuat kedua history terlihat sama secara manual.

## Baseline dan metode

- Repo: [`fsoeltonione/nextaction`](https://github.com/fsoeltonione/nextaction)
- `master` yang diaudit: [`74cbbb64d0be7aa029e6f065290798bb94943e7a`](https://github.com/fsoeltonione/nextaction/commit/74cbbb64d0be7aa029e6f065290798bb94943e7a)
- Staging project: `njjybpswxalxjhqjlvqa`
- Production project: `khoygjyikxkdwonygzyh`
- Sumber kanonis pada master: **50 file** di `supabase/migrations/`
- History staging: **52 entri**; history production: **52 entri**
- Kategori berikut diberikan per baris, bukan hanya dibandingkan berdasarkan jumlah:
  - **COCOK LANGSUNG** — version cocok dengan timestamp sumber dan slug cocok.
  - **ALIAS/TIMESTAMP HISTORIS** — slug/sumber dapat dipetakan, namun nama/version menggunakan alias atau timestamp deploy historis.
  - **EFEK DIGANTIKAN MIGRASI LEBIH BARU** — SQL historis tidak perlu dijalankan ulang karena state akhir yang dimaksud dibuktikan oleh migrasi/katalog lebih baru.
  - **KHUSUS STAGING** — bootstrap/fixture atau salinan executable untuk staging, bukan source migrasi produksi.
  - **BELUM TERJELASKAN** — bukti yang tersedia tidak mengizinkan mapping unik. Status ini sengaja tidak “ditebak”.
- Kolom version/name yang dikembalikan Supabase tidak menyimpan hash isi SQL; untuk entri legacy tanpa file Git, status katalog akhir saja tidak membuktikan isi skrip yang pernah dijalankan.
- Verifikasi source: folder [`supabase/migrations`](https://github.com/fsoeltonione/nextaction/tree/master/supabase/migrations); salinan Stage 14 ada di [`supabase/staging`](https://github.com/fsoeltonione/nextaction/tree/master/supabase/staging).
- Catatan audit pendahuluan: [staging-production-migration-reconciliation-2026-10-13.md](https://github.com/fsoeltonione/nextaction/blob/master/docs/operations/staging-production-migration-reconciliation-2026-10-13.md)
- Migrasi forward-only normalisasi scope: [`20261013010000_rate_limit_scope_normalization.sql`](https://github.com/fsoeltonione/nextaction/blob/master/supabase/migrations/20261013010000_rate_limit_scope_normalization.sql), ditambahkan lewat [PR #135](https://github.com/fsoeltonione/nextaction/pull/135). Disposable replay [run 38302803020](https://github.com/fsoeltonione/nextaction/actions/runs/38302803020) lulus (51 versions termasuk baseline disposable, 81 assertions); quality [run 38302803155](https://github.com/fsoeltonione/nextaction/actions/runs/38302803155) lulus. Hosted staging/production belum disentuh migrasi tersebut.

## Ringkasan hasil

| Ukuran | Hasil |
|---|---:|
| File sumber kanonis di master | 50 |
| History staging | 52 |
| History production | 52 |
| History staging berstatus belum terjelaskan | 0 |
| History production berstatus belum terjelaskan | 2 |
| Migrasi scope-normalization baru yang belum diterapkan hosted | 1 (sengaja pending) |

### Bukti katalog yang dicocokkan

Read-only catalog checks pada kedua environment menunjukkan hal berikut:

1. PostgreSQL 17.6.1.166 pada staging dan production.
2. Objek inti yang diperiksa hadir pada keduanya: unique index credential hash; `private.decisions.moment_id`, FK dan index; unique index pada event di moment occurrences.
3. Trigger `trg_validate_offer_moment_tenant` dan fungsi validator tenant lama tidak ada di kedua DB.
4. RPC lama `public.runtime_ack_event` dan `public.runtime_dequeue_events` tidak ada di kedua DB.
5. `public.create_offer_activation` dan `public.production_smoke_fixture_verify` memiliki hash definisi sama pada kedua DB. Verifier memiliki `ORDER BY c.clicked_at DESC, c.id DESC`.
6. Legacy activation RPCs mempunyai grant akhir `anon=false`, `authenticated=false`, `service_role=true` di kedua DB.
7. State schema Stage 14: tidak ada relasi `public.stage14_*` yang tertinggal; satu auth fixture `stage14-smoke@nextaction.invalid` tersisa di staging dan tidak ada di production.
8. Perbedaan katalog yang masih nyata: `public.check_runtime_rate_limit` di staging menyimpan `pg_catalog.btrim(p_scope)`; produksi menyimpan `p_scope` mentah. Ini dapat membuat scope dengan whitespace memakai bucket berbeda. Kedua tabel rate limit kosong pada snapshot sebelumnya, tetapi itu **bukan bukti bahwa tidak ada traffic**.
9. Perbedaan lain yang belum ditutup: `service_role` memiliki `USAGE` pada schema `pgmq` di production, tetapi tidak di staging. Ini perlu kebijakan eksplisit; ledger tidak mengubah grant tersebut.
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
| `20260926123026` | `20260925212930_stage_8_function_grant_hardening` | supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123033` | `20260926010000_stage_8_function_grant_hardening` | supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260926123123` | `stage14_staging_stage9_runtime_core` | supabase/migrations/20260926030000_stage_9_runtime_core.sql | **KHUSUS STAGING** | Salinan executable staging di supabase/staging/STAGE14_STAGE9_RUNTIME_CORE.sql; key tables/index/FK ada di kedua DB. |
| `20260926123133` | `stage14_staging_stage9_hardening` | supabase/migrations/20260926040000_stage_9_hardening.sql | **KHUSUS STAGING** | Salinan staging Stage 9; trigger tenant lama sudah tidak ada dan create_offer_activation sama antar-environment. |
| `20260926123139` | `stage14_staging_stage9_surface_cleanup` | supabase/migrations/20260926044000_stage_9_runtime_surface_cleanup.sql | **KHUSUS STAGING** | Salinan staging cleanup; kedua RPC antrean usang tidak ada di kedua DB. |
| `20260926123146` | `stage14_staging_stage9_rate_limit_reconciliation` | supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql | **KHUSUS STAGING** | Salinan executable di supabase/staging/STAGE14_STAGE9_RATE_LIMIT_RECONCILIATION.sql; staging trim scope, produksi masih menyimpan p_scope mentah. |
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
| `20260925212930` | `stage_8_function_grant_hardening` | supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925214730` | `20260926030000_stage_9_runtime_core` | supabase/migrations/20260926030000_stage_9_runtime_core.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925215138` | `stage_9_runtime_reconciliation` | tidak ada file sumber unik di master | **BELUM TERJELASKAN** | Dua entri dengan nama sama (versi 20260925215138 dan 20260925215209); tidak ada file sumber tracked atau checksum SQL untuk menautkan setiap baris secara unik. Keadaan akhir objek tidak membuktikan SQL mana yang dijalankan pada masing-masing entri. |
| `20260925215209` | `stage_9_runtime_reconciliation` | tidak ada file sumber unik di master | **BELUM TERJELASKAN** | Dua entri dengan nama sama (versi 20260925215138 dan 20260925215209); tidak ada file sumber tracked atau checksum SQL untuk menautkan setiap baris secara unik. Keadaan akhir objek tidak membuktikan SQL mana yang dijalankan pada masing-masing entri. |
| `20260925215210` | `stage_9_hardening` | supabase/migrations/20260926040000_stage_9_hardening.sql | **ALIAS/TIMESTAMP HISTORIS** | Slug/nama mengarah ke file sumber ini, tetapi versi history berbeda atau memakai timestamp historis. |
| `20260925215231` | `stage_9_runtime_hardening` | supabase/migrations/20260926030000_stage_9_runtime_core.sql | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Sumber lama spesifik tidak ada di master; efek inti yang terlihat (credential unique index, decisions.moment_id/FK/index, unique moment occurrence event index) ada pada kedua DB. Ini memetakan keadaan akhir, bukan membuktikan isi SQL historis persis. |
| `20260925215322` | `stage_9_runtime_sql_fix` | supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql + parser correction commit 6bd6b13b | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Nama lama cocok dengan perbaikan SQL/built-in Stage 9 yang kemudian masuk ke sumber kanonis. Fungsi live beroperasi, tetapi perilaku normalisasi scope di produksi tetap drift; status ini hanya untuk perbaikan sintaks, bukan bukti fungsi rate-limit seluruhnya konvergen. |
| `20260925215343` | `stage_9_runtime_builtin_fix` | supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql + parser correction commit 6bd6b13b | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Nama lama cocok dengan perbaikan SQL/built-in Stage 9 yang kemudian masuk ke sumber kanonis. Fungsi live beroperasi, tetapi perilaku normalisasi scope di produksi tetap drift; status ini hanya untuk perbaikan sintaks, bukan bukti fungsi rate-limit seluruhnya konvergen. |
| `20260925215416` | `stage_9_decision_runtime_hardening` | supabase/migrations/20260926040000_stage_9_hardening.sql dan migrasi decision/offer lebih baru | **EFEK DIGANTIKAN MIGRASI LEBIH BARU** | Nama sumber lama tidak ada di master; fungsi runtime decision/delivery sama antar-environment dan hardening offer/moment yang relevan hadir. Status didasarkan pada keadaan akhir objek, bukan ekuivalensi SQL byte-for-byte. |
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
| `supabase/migrations/20260925212930_stage_8_function_grant_hardening.sql` | `b2fec4a26523` | Tidak ada pasangan history terverifikasi | Tidak ada pasangan langsung; cek status superseded/gap |
| `supabase/migrations/20260925225318_stage_10_click_runtime.sql` | `432857bc0580` | ALIAS/TIMESTAMP HISTORIS (20260926123152) | COCOK LANGSUNG (20260925225318) |
| `supabase/migrations/20260926010000_stage_8_function_grant_hardening.sql` | `34f6acc7a5a2` | ALIAS/TIMESTAMP HISTORIS — row 20260926123033 | EFEK DIGANTIKAN MIGRASI LEBIH BARU — tidak ada row mandiri; grant final oleh 20260929010000_stage_16_read_only_control_plane.sql |
| `supabase/migrations/20260926030000_stage_12_qualified_click_runtime.sql` | `50465e5f9daa` | ALIAS/TIMESTAMP HISTORIS (20260926123202) | ALIAS/TIMESTAMP HISTORIS (20260925231337) |
| `supabase/migrations/20260926030000_stage_9_runtime_core.sql` | `4eebbc547ef9` | KHUSUS STAGING — executable copy STAGE14_STAGE9_RUNTIME_CORE.sql | ALIAS/TIMESTAMP HISTORIS — 20260925214730 |
| `supabase/migrations/20260926040000_stage_13_atomic_settlement_runtime.sql` | `16757a84d59f` | ALIAS/TIMESTAMP HISTORIS (20260926123209) | ALIAS/TIMESTAMP HISTORIS (20260925232043) |
| `supabase/migrations/20260926040000_stage_9_hardening.sql` | `7575142dba7b` | KHUSUS STAGING — stage14_staging_stage9_hardening | ALIAS/TIMESTAMP HISTORIS — 20260925215210 |
| `supabase/migrations/20260926040500_stage_13_settlement_index_cleanup.sql` | `8e49558349dd` | ALIAS/TIMESTAMP HISTORIS (20260926123215) | ALIAS/TIMESTAMP HISTORIS (20260925232130) |
| `supabase/migrations/20260926044000_stage_9_runtime_surface_cleanup.sql` | `6ec1b6563d9d` | KHUSUS STAGING — stage14_staging_stage9_surface_cleanup | ALIAS/TIMESTAMP HISTORIS — 20260925215802 |
| `supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql` | `b5c0cb5a361a` | KHUSUS STAGING — STAGE14_STAGE9_RATE_LIMIT_RECONCILIATION.sql | BELUM TERJELASKAN / DRIFT — tidak ada pasangan history unik; fungsi atomic upsert ada tetapi menyimpan scope tanpa btrim |
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
| `supabase/migrations/20261013010000_rate_limit_scope_normalization.sql` | `e8cf75965012` | BELUM DITERAPKAN — disengaja; tidak ada row history | BELUM DITERAPKAN — disengaja; tidak ada row history |

## D. Blocker lineage yang tersisa dan tindakan aman

### D1. Dua entri production belum terjelaskan

| Version | Name | Yang diketahui | Yang belum dapat dibuktikan |
|---|---|---|---|
| `20260925215138` | `stage_9_runtime_reconciliation` | Ada di ledger production, tidak ada file dengan path/nama itu di master. | Isi SQL dan efek unik entry ini tidak bisa dipisahkan secara tepercaya dari entry bernama sama berikutnya. |
| `20260925215209` | `stage_9_runtime_reconciliation` | Entri kedua dengan nama sama, beberapa menit setelah yang pertama. | Tidak ada blob/checksum SQL atau source path tersimpan untuk mengaitkan isi SQL secara satu-ke-satu. |

**Untuk menutup dua baris ini:** butuhkan artefak asal yang otoritatif (file SQL yang dieksekusi pada saat itu, transcript apply-migration yang berisi SQL, backup/source bundle, atau audit log yang benar-benar menyimpan statement). Tanpa bukti itu, jangan menyebut keduanya cocok langsung dan jangan edit history.

### D2. Canonical rate-limit migration tidak punya pasangan history production yang bersih

File `20260926050000_stage_9_runtime_rate_limit_reconciliation.sql` ada di master. Staging memakai executable copy Stage 14. Pada production, beberapa entry lama (`stage_9_runtime_sql_fix`, `stage_9_runtime_builtin_fix`) menjelaskan jalur perbaikan sintaks, tetapi tidak memberi provenance unik untuk seluruh isi migrasi kanonis. Body live production memiliki atomic upsert, namun menyimpan scope tanpa trim; itu bukti bahwa state yang sekarang **belum ekuivalen** dengan kontrak yang diharapkan.

Migrasi forward-only `20261013010000_rate_limit_scope_normalization.sql` adalah remediasi yang sudah diuji di disposable replay, namun **belum diterapkan ke staging maupun production**. Setelah row legacy D1 diselesaikan melalui artefak historis, lakukan canary staging dahulu, verifikasi body/grants/history, baru evaluasi produksi secara terpisah.

### D3. Legacy Stage 8 grant dan Stage 17 verifier sudah digantikan

- `20260926010000_stage_8_function_grant_hardening.sql`: tidak ada baris history mandiri di production, tetapi efek grant yang tepat telah digantikan oleh `20260929010000_stage_16_read_only_control_plane.sql`. Jangan reapply grant lama yang akan memberikan kembali `authenticated` execute.
- `20261003010000_stage_17_smoke_verifier_fix.sql`: tidak ada history mandiri di production, namun `20261003020000_stage_17_final_reconcile.sql` membawa correction yang sekarang terverifikasi pada kedua DB. Tidak perlu backfill history hanya untuk meniru staging.
- Dua nama history `stage14_staging_*` adalah jalur executable staging / alias untuk salinan staging; `stage14_staging_bootstrap` dan fixture seed bukan migrasi production. Fixture auth staging yang tertinggal telah dicatat di atas; jangan menghapusnya tanpa menilai efek pada smoke/fixture berikutnya.

### D4. Drift katalog non-lineage yang tetap perlu keputusan

- `pgmq` schema `USAGE` untuk `service_role`: production=true, staging=false.
- Perbedaan rendering beberapa default UUID qualified/unqualified yang sebelumnya ditemukan tampak setara secara semantik, tetapi belum dinormalisasi dalam deklarasi kanonis.
- Fungsi `private.runtime_quarantine_message`, `public.confirm_product_activation`, `public.resolve_runtime_integration`, `public.runtime_accept_event`, `public.runtime_readiness`, dan `public.runtime_worker_tick` memiliki hash definisi berbeda dalam snapshot. Jangan menganggap semuanya perbedaan kosmetik tanpa review semantik lanjutan; status mereka tidak boleh ditutup oleh hitungan index yang sama.

## E. Gerbang selesai yang direkomendasikan

Gerbang lineage baru boleh dinyatakan selesai setelah:
1. dua entri `stage_9_runtime_reconciliation` punya artefak sumber historis atau keputusan tertulis yang secara eksplisit menerima ketidakpastian tersebut (bukan tebakan);
2. seluruh pemetaan sumber `20260926050000_stage_9_runtime_rate_limit_reconciliation.sql` terhadap production terdokumentasi dan gap perilaku dicatat sebagai migrasi forward-only;
3. anomali grants dan function-definition diffs ditandai **diselesaikan** atau **diterima secara eksplisit** dengan bukti semantik;
4. staging canary untuk `20261013010000_rate_limit_scope_normalization.sql` lulus sesudah langkah 1–3; baru setelah itu buka review deployment production.

Tidak ada perubahan pada database hosted yang dilakukan sebagai bagian dari audit ini. Tidak ada instruksi untuk menyesuaikan row history secara manual. Ini adalah ledger lengkap atas entri yang teramati; beberapa entri berstatus **BELUM TERJELASKAN**, sehingga secara operasional gate produksi tetap **HOLD** sampai bukti tambahan tersedia.
