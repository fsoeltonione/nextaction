# Migration SQL content validation — 2026-10-11

## Purpose and scope

This report is the content-validation pass for the read-only migration-history manifest in `2026-10-11-migration-history-reconciliation-manifest.csv`. Each of the 104 remote migration-history rows (52 staging, 52 production) is classified against current local SQL candidates.

**This is not authorization to repair history or run migrations.** SQL statements and migration ledgers were read with SELECT-only queries. No DDL/DML, `supabase db push`, `supabase migration repair`, or production deployment was performed.

## Method

- Read each remote row's `statements` array and joined it with LF line breaks.
- Compared with local `supabase/migrations/*.sql` source after normalizing CRLF to LF, trimming trailing horizontal whitespace per line, and ignoring leading/trailing blank whitespace.
- Did **not** collapse internal whitespace, alter comments, or normalize SQL expressions. Different statements remain flagged for manual diff/effect review.
- A content match is not a migration-history match: remote version can still differ from the local filename's timestamp. The CSV distinguishes version-prefix matches from content matches with version drift.

## Summary

| Environment | Exact SQL content matches | SQL differs — effect review required | No local SQL candidate |
|---|---:|---:|---:|
| Staging | 31 | 19 | 2 |
| Production | 31 | 15 | 6 |

The validation mapping accounts for every remote-history row; there are no `UNCLASSIFIED_BLOCKING` rows.

## Staging rows with no exact content match to current local SQL

### SQL differs — review the full SQL diff and schema effects

| Remote version | Remote name | Local candidate |
|---|---|---|
| `20260926123123` | `stage14_staging_stage9_runtime_core` | 20260926030000_stage_9_runtime_core.sql |
| `20260926123146` | `stage14_staging_stage9_rate_limit_reconciliation` | 20260926050000_stage_9_runtime_rate_limit_reconciliation.sql |
| `20260928110208` | `stage_16_activation_workspace_context` | 20260928053000_stage_16_activation_workspace_context.sql |
| `20260928110412` | `stage_16_v2_function_privilege_hardening` | 20260928180000_stage_16_v2_function_privilege_hardening.sql |
| `20260928110633` | `stage_16_private_table_deny_policies` | 20260928180500_stage_16_private_table_deny_policies.sql |
| `20260928112537` | `stage_16_v2_workspace_scope_qualification` | 20260928183000_stage_16_v2_workspace_scope_qualification.sql |
| `20260928112623` | `stage_16_v2_initial_workspace_context_fix` | 20260928185000_stage_16_v2_initial_workspace_context_fix.sql |
| `20260928134106` | `stage_16_first_workspace_rls_bootstrap` | 20260928193000_stage_16_first_workspace_rls_bootstrap.sql |
| `20260928140437` | `20260928194500_stage_16_first_workspace_insert_returning_rls` | 20260928194500_stage_16_first_workspace_insert_returning_rls.sql |
| `20260928163633` | `stage_16_atomic_integration_credential_provisioning` | 20260928233000_stage_16_atomic_integration_credential_provisioning.sql |
| `20260928180258` | `stage_16_read_only_control_plane` | 20260929010000_stage_16_read_only_control_plane.sql |
| `20261003013324` | `stage_17_remediation` | 20261003000000_stage_17_remediation.sql |
| `20261003154220` | `stage_17_remediation` | 20261003000000_stage_17_remediation.sql |
| `20261003154641` | `stage_17_final_reconcile` | 20261003020000_stage_17_final_reconcile.sql |
| `20261003165532` | `h0_h1_runtime_hardening` | 20261003230000_h0_h1_runtime_hardening.sql |
| `20261003175300` | `h2_1_runtime_failure_containment` | 20261004010000_h2_1_runtime_failure_containment.sql |
| `20261003180823` | `h2_2_recovery_operations` | 20261004020000_h2_2_recovery_operations.sql |
| `20261003193248` | `h2_3_release_reliability_proof` | 20261004030000_h2_3_release_reliability_proof.sql |
| `20261011105247` | `h4_4_redundant_financial_accounts_index` | 20261011120000_h4_4_redundant_financial_accounts_index.sql |

### No local source candidate

| Remote version | Remote name | Local candidate |
|---|---|---|
| `20260926122918` | `stage14_staging_bootstrap` | — |
| `20260926215632` | `stage14_make_credit_fixture_repeatable` | — |

## Production rows with no exact content match to current local SQL

### SQL differs — review the full SQL diff and schema effects

| Remote version | Remote name | Local candidate |
|---|---|---|
| `20260925205217` | `stage_6_production_foundation` | 20260925205217_stage_6_production_foundation.sql |
| `20260925211435` | `stage_8_activation_foundation` | 20260925211435_stage_8_activation_foundation.sql |
| `20260925211519` | `stage_8_activation_foundation_hardening` | 20260925211519_stage_8_activation_foundation_hardening.sql |
| `20260925212247` | `stage_8_capability_enforcement` | 20260925212247_stage_8_capability_enforcement.sql |
| `20260925212601` | `stage_8_destination_url_compatibility` | 20260925212601_stage_8_destination_url_compatibility.sql |
| `20260925214730` | `20260926030000_stage_9_runtime_core` | 20260926030000_stage_9_runtime_core.sql |
| `20260925215210` | `stage_9_hardening` | 20260926040000_stage_9_hardening.sql |
| `20260928165116` | `stage_16_atomic_integration_credential_provisioning` | 20260928233000_stage_16_atomic_integration_credential_provisioning.sql |
| `20260929090426` | `stage_16_read_only_control_plane` | 20260929010000_stage_16_read_only_control_plane.sql |
| `20261003013723` | `stage_17_remediation` | 20261003000000_stage_17_remediation.sql |
| `20261003154650` | `stage_17_final_reconcile` | 20261003020000_stage_17_final_reconcile.sql |
| `20261003175812` | `h2_1_runtime_failure_containment` | 20261004010000_h2_1_runtime_failure_containment.sql |
| `20261003182724` | `h2_2_recovery_operations` | 20261004020000_h2_2_recovery_operations.sql |
| `20261003182730` | `h2_2_runtime_ops_hardening` | 20261004021000_h2_2_runtime_ops_hardening.sql |
| `20261003193255` | `h2_3_release_reliability_proof` | 20261004030000_h2_3_release_reliability_proof.sql |

### No local source candidate

| Remote version | Remote name | Local candidate |
|---|---|---|
| `20260925215138` | `stage_9_runtime_reconciliation` | — |
| `20260925215209` | `stage_9_runtime_reconciliation` | — |
| `20260925215231` | `stage_9_runtime_hardening` | — |
| `20260925215322` | `stage_9_runtime_sql_fix` | — |
| `20260925215343` | `stage_9_runtime_builtin_fix` | — |
| `20260925215416` | `stage_9_decision_runtime_hardening` | — |

## Required before any migration-history change

1. Review every `SQL_CONTENT_DIFFERS_REQUIRES_EFFECT_REVIEW` row with a statement-level diff. Classify each as comment/format-only, semantically equivalent but edited, or semantically different.
2. Trace every `NO_LOCAL_SQL_CANDIDATE` row to an authoritative historical SQL source or prove it is obsolete/duplicate with effect evidence.
3. Compare schema-only snapshots (columns, constraints, indexes, RLS policies, functions, triggers, grants) between staging and production, and verify differences are explained by the approved canonical migration chain. Current-schema similarity by itself does not prove which SQL ran.
4. Resolve the two duplicate local filename timestamp prefixes before relying on a clean local reset:
   - `20260926030000_stage_9_runtime_core.sql` and `20260926030000_stage_12_qualified_click_runtime.sql`
   - `20260926040000_stage_9_hardening.sql` and `20260926040000_stage_13_atomic_settlement_runtime.sql`
5. On a disposable database, prove a clean reset reconstructs expected schema. Then run `supabase migration list --linked` and `supabase db push --dry-run` against staging only, after the canonical chain is reviewed.
6. Produce a separate, reviewed, per-environment repair manifest. Only after it passes review should anyone consider an explicitly approved production change.

**Decision: no migration history repair is approved by this report.** Production remains unchanged. Rows marked as matching content still require version/history reconciliation, and all SQL-difference / remote-only rows remain blockers.
