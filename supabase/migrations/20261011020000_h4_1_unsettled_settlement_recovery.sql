-- H4.1: recover qualified clicks that were validly recorded while advertiser
-- capacity was unavailable. Recovery is server-only, bounded, idempotent, and
-- runs as part of the already-monitored runtime operations cron job.
--
-- A qualifying click is retained when settlement returns no_capacity by
-- business contract. Delivery tokens expire independently; settlement recovery
-- therefore operates on the immutable Qualified Click ID and never needs the
-- browser token or a redirect retry.

BEGIN;

CREATE OR REPLACE FUNCTION private.reconcile_unsettled_qualified_clicks(
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $recovery$
DECLARE
  v_candidate RECORD;
  v_outcome TEXT;
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
  v_attempted INTEGER := 0;
  v_settled INTEGER := 0;
  v_replayed INTEGER := 0;
  v_no_capacity INTEGER := 0;
  v_financial_unavailable INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid settlement recovery limit'
      USING ERRCODE = '22023';
  END IF;

  FOR v_candidate IN
    SELECT qc.id
    FROM private.qualified_clicks AS qc
    JOIN private.clicks AS c
      ON c.id = qc.click_id
    JOIN private.deliveries AS d
      ON d.id = c.delivery_id
    JOIN public.offers AS o
      ON o.id = d.offer_id
    JOIN public.integrations AS i
      ON i.id = d.integration_id
    JOIN public.products AS p
      ON p.id = i.product_id
    WHERE c.qualification_status = 'qualified'
      AND qc.qualified_at < v_checked_at - INTERVAL '5 minutes'
      AND NOT EXISTS (
        SELECT 1
        FROM private.settlements AS s
        WHERE s.qualified_click_id = qc.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM private.runtime_excluded_workspaces AS x
        WHERE x.workspace_id IN (o.workspace_id, p.workspace_id)
      )
    ORDER BY qc.qualified_at, qc.id
    FOR UPDATE OF qc SKIP LOCKED
    LIMIT p_limit
  LOOP
    v_attempted := v_attempted + 1;
    v_outcome := NULL;

    -- One broken/temporarily unavailable settlement must not prevent the
    -- operations job from recovering other eligible Qualified Clicks.
    BEGIN
      SELECT r.result_outcome
      INTO v_outcome
      FROM public.runtime_settle_qualified_click(v_candidate.id) AS r
      LIMIT 1;

      CASE v_outcome
        WHEN 'settled' THEN
          v_settled := v_settled + 1;
        WHEN 'replayed' THEN
          v_replayed := v_replayed + 1;
        WHEN 'no_capacity' THEN
          v_no_capacity := v_no_capacity + 1;
        WHEN 'financial_unavailable' THEN
          v_financial_unavailable := v_financial_unavailable + 1;
        ELSE
          v_failed := v_failed + 1;
      END CASE;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'checked_at', v_checked_at,
    'attempted', v_attempted,
    'settled', v_settled,
    'replayed', v_replayed,
    'no_capacity', v_no_capacity,
    'financial_unavailable', v_financial_unavailable,
    'failed', v_failed
  );
END;
$recovery$;

REVOKE ALL ON FUNCTION private.reconcile_unsettled_qualified_clicks(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reconcile_unsettled_qualified_clicks(INTEGER)
  TO service_role;

-- Preserve the existing bounded Event/queue recovery and cleanup job, adding
-- a bounded attempt to recover old Qualified Clicks without Settlement.
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
  v_qualified_click_recovery JSONB := '{}'::JSONB;
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF p_stale_after_seconds < 60 OR p_stale_after_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid stale event threshold' USING ERRCODE = '22023';
  END IF;
  IF p_rate_limit_retention_seconds < 3600 OR p_rate_limit_retention_seconds > 604800 THEN
    RAISE EXCEPTION 'invalid rate limit retention' USING ERRCODE = '22023';
  END IF;
  IF p_recovery_limit < 1 OR p_recovery_limit > 500 THEN
    RAISE EXCEPTION 'invalid recovery limit' USING ERRCODE = '22023';
  END IF;

  FOR v_event IN
    SELECT e.id FROM private.events AS e
    WHERE e.processing_status = 'processing'
      AND e.received_at < v_checked_at - pg_catalog.make_interval(secs => p_stale_after_seconds)
      AND EXISTS (SELECT 1 FROM private.moment_occurrences AS mo WHERE mo.event_id = e.id)
    ORDER BY e.received_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_recovery_limit
  LOOP
    UPDATE private.events SET processing_status = 'processed'
    WHERE id = v_event.id AND processing_status = 'processing';
    IF FOUND THEN v_recovered_processed := v_recovered_processed + 1; END IF;
  END LOOP;

  FOR v_event IN
    SELECT e.id FROM private.events AS e
    WHERE e.processing_status IN ('accepted', 'processing')
      AND e.received_at < v_checked_at - pg_catalog.make_interval(secs => p_stale_after_seconds)
      AND NOT EXISTS (SELECT 1 FROM private.moment_occurrences AS mo WHERE mo.event_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM pgmq."q_runtime-events" AS q
        WHERE q.message->>'event_id' = e.id::TEXT
      )
    ORDER BY e.received_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_recovery_limit
  LOOP
    UPDATE private.events SET
      processing_status = 'accepted',
      last_failure_class = 'retryable',
      last_failure_code = 'stale_event_recovered',
      last_failure_reason = 'Stale runtime Event was recovered because its queue message was missing.',
      last_failed_at = v_checked_at
    WHERE id = v_event.id AND processing_status IN ('accepted', 'processing');

    PERFORM pgmq.send('runtime-events', pg_catalog.jsonb_build_object('event_id', v_event.id::TEXT));
    v_requeued := v_requeued + 1;
  END LOOP;

  v_qualified_click_recovery :=
    private.reconcile_unsettled_qualified_clicks(p_recovery_limit);

  DELETE FROM private.rate_limit_buckets
  WHERE window_started_at < v_checked_at - pg_catalog.make_interval(secs => p_rate_limit_retention_seconds);
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM private.runtime_dead_letters
  WHERE quarantined_at < v_checked_at - INTERVAL '30 days';
  GET DIAGNOSTICS v_dead_letter_deleted = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'checked_at', v_checked_at,
    'stale_events_marked_processed', v_recovered_processed,
    'stale_events_requeued', v_requeued,
    'qualified_click_settlement_recovery', v_qualified_click_recovery,
    'rate_limit_buckets_deleted', v_rate_limit_deleted,
    'dead_letters_deleted', v_dead_letter_deleted
  );
END;
$ops$;

REVOKE ALL ON FUNCTION public.runtime_operations_tick(INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_operations_tick(INTEGER, INTEGER, INTEGER)
  TO service_role;

COMMIT;
