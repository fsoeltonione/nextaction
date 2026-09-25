-- NextAction Stage 9 runtime reconciliation
-- Align live state with the authoritative Stage 9 source and close
-- the rate-limit/idempotency correctness gaps found during verification.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Remove the temporary duplicate worker introduced during reconciliation.
-- The authoritative worker is runtime_worker_tick + nextaction-runtime-worker.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'nextaction-runtime-events'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.runtime_drain_events(INTEGER);

-- ---------------------------------------------------------------------------
-- 2. Fix rate-limit lookup ambiguity.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_runtime_rate_limit(
  p_scope TEXT,
  p_subject_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER,
  request_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_scope IS NULL OR pg_catalog.length(trim(p_scope)) < 1 OR pg_catalog.length(p_scope) > 100 THEN
    RAISE EXCEPTION 'invalid rate limit scope' USING ERRCODE = '22023';
  END IF;

  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid rate limit subject' USING ERRCODE = '22023';
  END IF;

  IF p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'invalid rate limit limit' USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit window' USING ERRCODE = '22023';
  END IF;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM v_now) / p_window_seconds
    ) * p_window_seconds
  );
  v_window_end := v_window_start + pg_catalog.make_interval(secs => p_window_seconds);

  INSERT INTO private.rate_limit_buckets (
    scope, subject_hash, window_started_at, request_count
  )
  VALUES (
    p_scope,
    p_subject_hash,
    v_window_start,
    1
  )
  ON CONFLICT (scope, subject_hash)
  DO UPDATE
  SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN private.rate_limit_buckets.window_started_at = EXCLUDED.window_started_at
        THEN private.rate_limit_buckets.request_count + 1
      ELSE 1
    END
  RETURNING request_count INTO v_count;

  RETURN QUERY
  SELECT
    v_count <= p_limit,
    pg_catalog.greatest(p_limit - v_count, 0),
    pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        extract(epoch FROM (v_window_end - pg_catalog.clock_timestamp()))
      )::INTEGER
    ),
    v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.check_runtime_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_runtime_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Idempotency keys are bound to the original request payload.
-- Reusing a key for different data is a conflict, not a replay.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.runtime_accept_event(
  p_integration_id UUID,
  p_idempotency_key TEXT,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_payload JSONB,
  p_request_id UUID
)
RETURNS TABLE (
  result_event_id UUID,
  result_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id UUID;
  v_created BOOLEAN := FALSE;
  v_existing_event_type TEXT;
  v_existing_occurred_at TIMESTAMPTZ;
  v_existing_payload JSONB;
BEGIN
  IF p_integration_id IS NULL THEN
    RAISE EXCEPTION 'integration is required' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF p_event_type IS NULL
     OR p_event_type !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
  THEN
    RAISE EXCEPTION 'invalid event type' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'event data must be an object' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.integrations AS i
    JOIN public.products AS p
      ON p.id = i.product_id
    JOIN public.workspace_capabilities AS wc
      ON wc.workspace_id = p.workspace_id
     AND wc.capability = 'make_money'
     AND wc.status = 'active'
    WHERE i.id = p_integration_id
      AND i.status = 'active'
      AND i.revoked_at IS NULL
      AND p.understanding_status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'integration is not active' USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.events (
    integration_id,
    idempotency_key,
    event_type,
    occurred_at,
    payload,
    request_id
  )
  VALUES (
    p_integration_id,
    trim(p_idempotency_key),
    trim(p_event_type),
    p_occurred_at,
    p_payload,
    p_request_id
  )
  ON CONFLICT (integration_id, idempotency_key)
  DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    v_created := TRUE;
    PERFORM pgmq.send(
      'runtime-events',
      pg_catalog.jsonb_build_object('event_id', v_event_id::TEXT)
    );
  ELSE
    SELECT
      e.id,
      e.event_type,
      e.occurred_at,
      e.payload
    INTO
      v_event_id,
      v_existing_event_type,
      v_existing_occurred_at,
      v_existing_payload
    FROM private.events AS e
    WHERE e.integration_id = p_integration_id
      AND e.idempotency_key = trim(p_idempotency_key)
    LIMIT 1;

    IF v_existing_event_type IS DISTINCT FROM trim(p_event_type)
       OR v_existing_occurred_at IS DISTINCT FROM p_occurred_at
       OR v_existing_payload IS DISTINCT FROM p_payload
    THEN
      RAISE EXCEPTION 'idempotency key was already used with different event data'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN QUERY SELECT v_event_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_accept_event(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_accept_event(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID)
  TO service_role;

COMMIT;
