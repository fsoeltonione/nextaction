BEGIN;
SELECT plan(9);

SELECT ok(
  position('nextaction-runtime-integrity-audit' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness contract names the integrity-audit scheduler'
);

SELECT ok(
  position('private.runtime_integrity_snapshots' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness contract inspects persisted integrity snapshots'
);

SELECT ok(
  position('v_integrity_audit_recent_success' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness contract requires a recent successful integrity-audit run'
);

SELECT ok(
  position('v_integrity_snapshot_healthy' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness contract requires a fresh zero-anomaly OK snapshot'
);

SELECT ok(
  (public.runtime_readiness() ? 'integrity_audit')
    AND (public.runtime_readiness() ? 'integrity_snapshot'),
  'readiness output exposes scheduler and latest-snapshot status separately'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_audit'->>'schedule_active' = 'true'),
  'readiness cannot be ready while integrity-audit schedule is inactive or missing'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_audit'->>'recent_success' = 'true'),
  'readiness cannot be ready without a recent successful integrity-audit run'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_snapshot'->>'fresh_and_healthy' = 'true'),
  'readiness cannot be ready without a fresh zero-anomaly integrity snapshot'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (
    public.runtime_readiness()->'worker'->>'schedule_active' = 'true'
    AND public.runtime_readiness()->'worker'->>'recent_success' = 'true'
    AND public.runtime_readiness()->'operations'->>'schedule_active' = 'true'
    AND public.runtime_readiness()->'operations'->>'recent_success' = 'true'
  ),
  'readiness cannot be ready unless worker and operations jobs are active and recent'
);

SELECT * FROM finish();
ROLLBACK;
