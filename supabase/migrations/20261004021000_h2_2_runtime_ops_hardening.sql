-- NextAction H2.2 follow-up: make operational readiness reflect the latest
-- scheduler run and bound dead-letter retention.

BEGIN;

CREATE OR REPLACE FUNCTION public.runtime_operations_tick(
  p_stale_after_seconds INTEGER DEFAULT 300,
  p_rate_limit_retention_seconds INTEGER DEFAULT 7200,
  p_recovery_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $ops$
DECLARE
  v_event RECORD;
  v_recovered_processed INTEGER := 0;
  v_requeued INTEGER := 0;
  v_rate_limit_deleted INTEGER := 0;
  v_dead_letter_deleted INTEGER := 0;
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF p_stale_after_seconds < 60 OR p_stale_after_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid stale event threshold' USING ERRCODE = '22023';
  END IF;

  IF p_rate_limit_retention_seconds < 3600
     OR p_rate_limit_retention_seconds > 604800
  THEN
    RAISE EXCEPTION 'invalid rate limit retention' USING ERRCODE = '22023';
  END IF;

  IF p_recovery_limit < 1 OR p_recovery_limit > 500 THEN
    RAISE EXCEPTION 'invalid recovery limit' USING ERRCODE = '22023';
  END IF;

  FOR v_event IN
    SELECT e.id
    FROM private.events AS e
    WHERE e.processing_status = 'processing'
      AND e.received_at < v_checked_at
        - pg_catalog.make_interval(secs => p_stale_after_seconds)
      AND EXISTS (
        SELECT 1
        FROM private.moment_occurrences AS mo
        WHERE mo.event_id = e.id
      )
    ORDER BY e.received_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_recovery_limit
  LOOP
    UPDATE private.events
    SET processing_status = 'processed'
    WHERE id = v_event.id
      AND processing_status = 'processing';

    IF FOUND THEN
      v_recovered_processed := v_recovered_processed + 1;
    END IF;
  END LOOP;

  FOR v_event IN
    SELECT e.id, e.request_id
    FROM private.events AS e
    WHERE e.processing_status IN ('accepted', 'processing')
      AND e.received_at < v_checked_at
        - pg_catalog.make_interval(secs => p_stale_after_seconds)
      AND NOT EXISTS (
        SELECT 1
        FROM private.moment_occurrences AS mo
        WHERE mo.event_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pgmq."q_runtime-events" AS q
        WHERE q.message->>'event_id' = e.id::TEXT
      )
    ORDER BY e.received_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_recovery_limit
  LOOP
    UPDATE private.events
    SET
      processing_status = 'accepted',
      last_failure_class = 'retryable',
      last_failure_code = 'stale_event_recovered',
      last_failure_reason = 'Stale runtime Event was recovered because its queue message was missing.',
      last_failed_at = v_checked_at
    WHERE id = v_event.id
      AND processing_status IN ('accepted', 'processing');

    PERFORM pgmq.send(
      'runtime-events',
      pg_catalog.jsonb_build_object('event_id', v_event.id::TEXT)
    );

    v_requeued := v_requeued + 1;
  END LOOP;

  DELETE FROM private.rate_limit_buckets
  WHERE window_started_at < v_checked_at
    - pg_catalog.make_interval(secs => p_rate_limit_retention_seconds);

  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM private.runtime_dead_letters
  WHERE quarantined_at < v_checked_at - INTERVAL '30 days';

  GET DIAGNOSTICS v_dead_letter_deleted = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'checked_at', v_checked_at,
    'stale_events_marked_processed', v_recovered_processed,
    'stale_events_requeued', v_requeued,
    'rate_limit_buckets_deleted', v_rate_limit_deleted,
    'dead_letters_deleted', v_dead_letter_deleted
  );
END;
$ops$;

REVOKE ALL ON FUNCTION public.runtime_operations_tick(INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.runtime_operations_tick(INTEGER, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.runtime_readiness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $ready$
DECLARE
  v_worker_job_id BIGINT;
  v_operations_job_id BIGINT;
  v_worker_active BOOLEAN := FALSE;
  v_operations_active BOOLEAN := FALSE;
  v_worker_recent_success BOOLEAN := FALSE;
  v_operations_recent_success BOOLEAN := FALSE;
  v_worker_last_status TEXT;
  v_operations_last_status TEXT;
  v_worker_last_start TIMESTAMPTZ;
  v_operations_last_start TIMESTAMPTZ;
  v_queue_exists BOOLEAN := FALSE;
  v_worker_exists BOOLEAN := FALSE;
  v_queue_count INTEGER := 0;
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
  v_core_ready BOOLEAN;
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

  SELECT count(*)::INTEGER
  INTO v_queue_count
  FROM pgmq."q_runtime-events";

  v_core_ready :=
    v_queue_exists
    AND v_worker_exists
    AND v_worker_active
    AND v_worker_recent_success;

  RETURN pg_catalog.jsonb_build_object(
    'status',
      CASE WHEN v_core_ready THEN 'ready' ELSE 'not_ready' END,
    'checked_at',
      v_checked_at,
    'queue',
      pg_catalog.jsonb_build_object(
        'exists', v_queue_exists,
        'count', v_queue_count
      ),
    'worker',
      pg_catalog.jsonb_build_object(
        'function_exists', v_worker_exists,
        'schedule_active', v_worker_active,
        'recent_success', v_worker_recent_success,
        'last_run_status', v_worker_last_status,
        'last_run_started_at', v_worker_last_start
      ),
    'operations',
      pg_catalog.jsonb_build_object(
        'schedule_active', v_operations_active,
        'recent_success', v_operations_recent_success,
        'last_run_status', v_operations_last_status,
        'last_run_started_at', v_operations_last_start
      )
  );
END;
$ready$;

REVOKE ALL ON FUNCTION public.runtime_readiness()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.runtime_readiness()
  TO service_role;

COMMIT;
