-- NextAction Stage 9: runtime SQL correctness hardening
BEGIN;

-- Rate limiter: avoid collision between RETURNS TABLE request_count and the
-- physical column name by qualifying the INSERT target in RETURNING.
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
  IF p_scope IS NULL OR length(trim(p_scope)) < 1 OR length(p_scope) > 100 THEN
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

  INSERT INTO private.rate_limit_buckets AS b (
    scope, subject_hash, window_started_at, request_count
  )
  VALUES (p_scope, p_subject_hash, v_window_start, 1)
  ON CONFLICT (scope, subject_hash)
  DO UPDATE
  SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN b.window_started_at = EXCLUDED.window_started_at
        THEN b.request_count + 1
      ELSE 1
    END
  RETURNING b.request_count INTO v_count;

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

-- Event acceptance: trim() must stay unqualified, and idempotency keys are
-- immutable request identities.
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
    JOIN public.products AS p ON p.id = i.product_id
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

-- Event -> Moment: trim() must remain unqualified under an empty search_path.
CREATE OR REPLACE FUNCTION public.runtime_process_event(
  p_event_id UUID
)
RETURNS TABLE (
  result_processed BOOLEAN,
  result_moment_occurrence_id UUID,
  result_reason_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event private.events%ROWTYPE;
  v_product_id UUID;
  v_moment_id UUID;
  v_occurrence_id UUID;
  v_moment_key TEXT;
BEGIN
  SELECT e.*
  INTO v_event
  FROM private.events AS e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT mo.id
  INTO v_occurrence_id
  FROM private.moment_occurrences AS mo
  WHERE mo.event_id = p_event_id
  ORDER BY mo.occurred_at DESC, mo.id DESC
  LIMIT 1;

  IF v_occurrence_id IS NOT NULL THEN
    UPDATE private.events
    SET processing_status = 'processed'
    WHERE id = p_event_id;

    RETURN QUERY
    SELECT TRUE, v_occurrence_id, 'already_processed'::TEXT;
    RETURN;
  END IF;

  UPDATE private.events
  SET processing_status = 'processing'
  WHERE id = p_event_id;

  SELECT i.product_id
  INTO v_product_id
  FROM public.integrations AS i
  WHERE i.id = v_event.integration_id;

  IF v_product_id IS NULL THEN
    UPDATE private.events
    SET processing_status = 'failed'
    WHERE id = p_event_id;

    RETURN QUERY
    SELECT FALSE, NULL::UUID, 'integration_not_found'::TEXT;
    RETURN;
  END IF;

  v_moment_key := trim(
    both '_' FROM pg_catalog.lower(
      pg_catalog.regexp_replace(
        v_event.event_type,
        '[^a-zA-Z0-9]+',
        '_',
        'g'
      )
    )
  );

  IF v_moment_key = '' THEN
    UPDATE private.events
    SET processing_status = 'processed'
    WHERE id = p_event_id;

    RETURN QUERY
    SELECT TRUE, NULL::UUID, 'moment_not_registered'::TEXT;
    RETURN;
  END IF;

  SELECT m.id
  INTO v_moment_id
  FROM public.moments AS m
  WHERE m.product_id = v_product_id
    AND m.moment_key = v_moment_key
    AND m.status = 'active'
  LIMIT 1;

  IF v_moment_id IS NULL THEN
    UPDATE private.events
    SET processing_status = 'processed'
    WHERE id = p_event_id;

    RETURN QUERY
    SELECT TRUE, NULL::UUID, 'moment_not_registered'::TEXT;
    RETURN;
  END IF;

  INSERT INTO private.moment_occurrences (
    moment_id,
    event_id,
    integration_id,
    occurred_at,
    metadata
  )
  VALUES (
    v_moment_id,
    p_event_id,
    v_event.integration_id,
    COALESCE(v_event.occurred_at, v_event.received_at),
    v_event.payload
  )
  RETURNING id INTO v_occurrence_id;

  UPDATE private.events
  SET processing_status = 'processed'
  WHERE id = p_event_id;

  RETURN QUERY
  SELECT TRUE, v_occurrence_id, NULL::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE private.events
    SET processing_status = 'failed'
    WHERE id = p_event_id;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_process_event(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_process_event(UUID)
  TO service_role;

COMMIT;
