-- NextAction P2 / D10: make operational readiness reflect the complete
-- runtime-integrity contract. Forward-only: no business data is modified.
BEGIN;

CREATE OR REPLACE FUNCTION public.runtime_readiness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $ready$
DECLARE
  v_worker_job_id BIGINT;
  v_operations_job_id BIGINT;
  v_integrity_audit_job_id BIGINT;
  v_worker_active BOOLEAN := FALSE;
  v_operations_active BOOLEAN := FALSE;
  v_integrity_audit_active BOOLEAN := FALSE;
  v_worker_recent_success BOOLEAN := FALSE;
  v_operations_recent_success BOOLEAN := FALSE;
  v_integrity_audit_recent_success BOOLEAN := FALSE;
  v_worker_last_status TEXT;
  v_operations_last_status TEXT;
  v_integrity_audit_last_status TEXT;
  v_worker_last_start TIMESTAMPTZ;
  v_operations_last_start TIMESTAMPTZ;
  v_integrity_audit_last_start TIMESTAMPTZ;
  v_integrity_snapshot_status TEXT;
  v_integrity_snapshot_anomaly_count INTEGER;
  v_integrity_snapshot_checked_at TIMESTAMPTZ;
  v_integrity_snapshot_healthy BOOLEAN := FALSE;
  v_queue_exists BOOLEAN := FALSE;
  v_worker_exists BOOLEAN := FALSE;
  v_queue_count INTEGER := 0;
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
  v_ready BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pgmq.list_queues()
    WHERE queue_name = 'runtime-events'
  )
  INTO v_queue_exists;

  SELECT to_regprocedure('public.runtime_worker_tick(integer,integer)') IS NOT NULL
  INTO v_worker_exists;

  SELECT jobid, active
  INTO v_worker_job_id, v_worker_active
  FROM cron.job
  WHERE jobname = 'nextaction-runtime-worker'
  LIMIT 1;

  SELECT jobid, active
  INTO v_operations_job_id, v_operations_active
  FROM cron.job
  WHERE jobname = 'nextaction-runtime-operations'
  LIMIT 1;

  SELECT jobid, active
  INTO v_integrity_audit_job_id, v_integrity_audit_active
  FROM cron.job
  WHERE jobname = 'nextaction-runtime-integrity-audit'
  LIMIT 1;

  IF v_worker_job_id IS NOT NULL THEN
    SELECT d.status, d.start_time
    INTO v_worker_last_status, v_worker_last_start
    FROM cron.job_run_details AS d
    WHERE d.jobid = v_worker_job_id
    ORDER BY d.start_time DESC
    LIMIT 1;

    v_worker_recent_success :=
      v_worker_last_status = 'succeeded'
      AND v_worker_last_start >= v_checked_at - INTERVAL '3 minutes';
  END IF;

  IF v_operations_job_id IS NOT NULL THEN
    SELECT d.status, d.start_time
    INTO v_operations_last_status, v_operations_last_start
    FROM cron.job_run_details AS d
    WHERE d.jobid = v_operations_job_id
    ORDER BY d.start_time DESC
    LIMIT 1;

    v_operations_recent_success :=
      v_operations_last_status = 'succeeded'
      AND v_operations_last_start >= v_checked_at - INTERVAL '10 minutes';
  END IF;

  IF v_integrity_audit_job_id IS NOT NULL THEN
    SELECT d.status, d.start_time
    INTO v_integrity_audit_last_status, v_integrity_audit_last_start
    FROM cron.job_run_details AS d
    WHERE d.jobid = v_integrity_audit_job_id
    ORDER BY d.start_time DESC
    LIMIT 1;

    v_integrity_audit_recent_success :=
      v_integrity_audit_last_status = 'succeeded'
      AND v_integrity_audit_last_start >= v_checked_at - INTERVAL '10 minutes';
  END IF;

  SELECT status, anomaly_count, checked_at
  INTO
    v_integrity_snapshot_status,
    v_integrity_snapshot_anomaly_count,
    v_integrity_snapshot_checked_at
  FROM private.runtime_integrity_snapshots
  ORDER BY checked_at DESC
  LIMIT 1;

  v_integrity_snapshot_healthy :=
    v_integrity_snapshot_status = 'ok'
    AND v_integrity_snapshot_anomaly_count = 0
    AND v_integrity_snapshot_checked_at >= v_checked_at - INTERVAL '10 minutes';

  SELECT count(*)::INTEGER
  INTO v_queue_count
  FROM pgmq."q_runtime-events";

  v_ready :=
    v_queue_exists
    AND v_worker_exists
    AND v_worker_active
    AND v_worker_recent_success
    AND v_operations_active
    AND v_operations_recent_success
    AND v_integrity_audit_active
    AND v_integrity_audit_recent_success
    AND v_integrity_snapshot_healthy;

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN v_ready THEN 'ready' ELSE 'not_ready' END,
    'checked_at', v_checked_at,
    'queue', pg_catalog.jsonb_build_object(
      'exists', v_queue_exists,
      'count', v_queue_count
    ),
    'worker', pg_catalog.jsonb_build_object(
      'function_exists', v_worker_exists,
      'schedule_active', v_worker_active,
      'recent_success', v_worker_recent_success,
      'last_run_status', v_worker_last_status,
      'last_run_started_at', v_worker_last_start
    ),
    'operations', pg_catalog.jsonb_build_object(
      'schedule_active', v_operations_active,
      'recent_success', v_operations_recent_success,
      'last_run_status', v_operations_last_status,
      'last_run_started_at', v_operations_last_start
    ),
    'integrity_audit', pg_catalog.jsonb_build_object(
      'schedule_active', v_integrity_audit_active,
      'recent_success', v_integrity_audit_recent_success,
      'last_run_status', v_integrity_audit_last_status,
      'last_run_started_at', v_integrity_audit_last_start
    ),
    'integrity_snapshot', pg_catalog.jsonb_build_object(
      'status', v_integrity_snapshot_status,
      'anomaly_count', v_integrity_snapshot_anomaly_count,
      'checked_at', v_integrity_snapshot_checked_at,
      'fresh_and_healthy', v_integrity_snapshot_healthy
    )
  );
END;
$ready$;

COMMIT;
