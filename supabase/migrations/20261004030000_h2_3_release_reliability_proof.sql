-- NextAction H2.3: Reliability Proof & Release Gate
-- Provide a service-only proof RPC for the final release gate. This does not
-- participate in the request path and does not mutate business state except
-- for the existing H1 integrity snapshot emitted by runtime_integrity_audit().

BEGIN;

CREATE OR REPLACE FUNCTION public.runtime_release_proof()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $proof$
DECLARE
  v_readiness JSONB;
  v_integrity JSONB;
  v_dead_letter_count INTEGER := 0;
  v_stale_rate_limit_count INTEGER := 0;
  v_migration_h2_1 BOOLEAN := FALSE;
  v_migration_h2_2_recovery BOOLEAN := FALSE;
  v_migration_h2_2_hardening BOOLEAN := FALSE;
  v_status TEXT;
BEGIN
  v_readiness := public.runtime_readiness();
  v_integrity := public.runtime_integrity_audit();

  SELECT count(*)::INTEGER
  INTO v_dead_letter_count
  FROM private.runtime_dead_letters;

  SELECT count(*)::INTEGER
  INTO v_stale_rate_limit_count
  FROM private.rate_limit_buckets
  WHERE window_started_at < timezone('utc'::text, now()) - INTERVAL '2 hours';

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = 'h2_1_runtime_failure_containment'
  ) INTO v_migration_h2_1;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = 'h2_2_recovery_operations'
  ) INTO v_migration_h2_2_recovery;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = 'h2_2_runtime_ops_hardening'
  ) INTO v_migration_h2_2_hardening;

  IF COALESCE(v_readiness->>'status', 'not_ready') = 'ready'
     AND COALESCE(v_readiness->'worker'->>'recent_success', 'false') = 'true'
     AND COALESCE(v_readiness->'worker'->>'schedule_active', 'false') = 'true'
     AND COALESCE(v_readiness->'operations'->>'recent_success', 'false') = 'true'
     AND COALESCE(v_readiness->'operations'->>'schedule_active', 'false') = 'true'
     AND COALESCE((v_readiness->'queue'->>'count')::INTEGER, -1) = 0
     AND COALESCE(v_integrity->>'status', 'critical') = 'ok'
     AND COALESCE((v_integrity->>'anomaly_count')::INTEGER, -1) = 0
     AND v_dead_letter_count = 0
     AND v_stale_rate_limit_count = 0
     AND v_migration_h2_1
     AND v_migration_h2_2_recovery
     AND v_migration_h2_2_hardening
  THEN
    v_status := 'ready';
  ELSE
    v_status := 'not_ready';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'checked_at', timezone('utc'::text, now()),
    'readiness', v_readiness,
    'integrity', v_integrity,
    'runtime_lifecycle', pg_catalog.jsonb_build_object(
      'dead_letter_count', v_dead_letter_count,
      'stale_rate_limit_bucket_count', v_stale_rate_limit_count
    ),
    'required_migrations', pg_catalog.jsonb_build_object(
      'h2_1_runtime_failure_containment', v_migration_h2_1,
      'h2_2_recovery_operations', v_migration_h2_2_recovery,
      'h2_2_runtime_ops_hardening', v_migration_h2_2_hardening
    )
  );
END;
$proof$;

REVOKE ALL ON FUNCTION public.runtime_release_proof()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_release_proof()
  TO service_role;

COMMIT;
