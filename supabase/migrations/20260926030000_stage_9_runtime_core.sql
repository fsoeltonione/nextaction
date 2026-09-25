-- NextAction Stage 9: Runtime Core + PGMQ + rate limiting
-- The public /v1/* application routes use service-role/secret-key RPCs only.
-- The runtime domain remains:
-- Event -> Moment -> Decision -> Delivery
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pgmq.list_queues()
    WHERE queue_name = 'runtime-events'
  ) THEN
    PERFORM pgmq.create('runtime-events');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Runtime hardening
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS integration_secrets_credential_hash_uq
  ON private.integration_secrets(credential_hash);

ALTER TABLE private.decisions
  ADD COLUMN IF NOT EXISTS moment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decisions_moment_id_fkey'
      AND conrelid = 'private.decisions'::regclass
  ) THEN
    ALTER TABLE private.decisions
      ADD CONSTRAINT decisions_moment_id_fkey
      FOREIGN KEY (moment_id)
      REFERENCES public.moments(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS decisions_moment_id_idx
  ON private.decisions(moment_id);

CREATE UNIQUE INDEX IF NOT EXISTS moment_occurrences_event_id_uq
  ON private.moment_occurrences(event_id)
  WHERE event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.rate_limit_buckets (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (scope, subject_hash)
);

ALTER TABLE private.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE private.rate_limit_buckets TO service_role;

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
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_current_window TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope)) < 1 OR length(p_scope) > 100 THEN
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

  v_window_start :=
    pg_catalog.to_timestamp(
      pg_catalog.floor(
        pg_catalog.extract(epoch FROM pg_catalog.clock_timestamp()) / p_window_seconds
      ) * p_window_seconds
    );
  v_window_end := v_window_start + pg_catalog.make_interval(secs => p_window_seconds);

  SELECT window_started_at, request_count
  INTO v_current_window, v_count
  FROM private.rate_limit_buckets
  WHERE scope = p_scope
    AND subject_hash = p_subject_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO private.rate_limit_buckets (
      scope, subject_hash, window_started_at, request_count
    )
    VALUES (p_scope, p_subject_hash, v_window_start, 1);

    RETURN QUERY
    SELECT
      TRUE,
      p_limit - 1,
      GREATEST(
        1,
        pg_catalog.ceil(
          pg_catalog.extract(epoch FROM (v_window_end - pg_catalog.clock_timestamp()))
        )::INTEGER
      ),
      1;
    RETURN;
  END IF;

  IF v_current_window < v_window_start THEN
    UPDATE private.rate_limit_buckets
    SET window_started_at = v_window_start,
        request_count = 1
    WHERE scope = p_scope
      AND subject_hash = p_subject_hash;

    RETURN QUERY
    SELECT
      TRUE,
      p_limit - 1,
      GREATEST(
        1,
        pg_catalog.ceil(
          pg_catalog.extract(epoch FROM (v_window_end - pg_catalog.clock_timestamp()))
        )::INTEGER
      ),
      1;
    RETURN;
  END IF;

  IF v_count >= p_limit THEN
    RETURN QUERY
    SELECT
      FALSE,
      0,
      GREATEST(
        1,
        pg_catalog.ceil(
          pg_catalog.extract(epoch FROM (v_window_end - pg_catalog.clock_timestamp()))
        )::INTEGER
      ),
      v_count;
    RETURN;
  END IF;

  v_count := v_count + 1;

  UPDATE private.rate_limit_buckets
  SET request_count = v_count
  WHERE scope = p_scope
    AND subject_hash = p_subject_hash;

  RETURN QUERY
  SELECT
    TRUE,
    p_limit - v_count,
    GREATEST(
      1,
      pg_catalog.ceil(
        pg_catalog.extract(epoch FROM (v_window_end - pg_catalog.clock_timestamp()))
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
-- Runtime credential resolution
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_runtime_integration(
  p_credential_hash TEXT
)
RETURNS TABLE (
  result_status TEXT,
  result_integration_id UUID,
  result_product_id UUID,
  result_workspace_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_integration_id UUID;
  v_product_id UUID;
  v_workspace_id UUID;
  v_status TEXT;
  v_revoked_at TIMESTAMPTZ;
  v_understanding_status TEXT;
BEGIN
  IF p_credential_hash IS NULL
     OR p_credential_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN QUERY
    SELECT
      'invalid_integration_credential'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID;
    RETURN;
  END IF;

  SELECT
    i.id,
    i.product_id,
    i.status,
    i.revoked_at,
    p.workspace_id,
    p.understanding_status
  INTO
    v_integration_id,
    v_product_id,
    v_status,
    v_revoked_at,
    v_workspace_id,
    v_understanding_status
  FROM private.integration_secrets AS s
  JOIN public.integrations AS i
    ON i.id = s.integration_id
  JOIN public.products AS p
    ON p.id = i.product_id
  WHERE s.credential_hash = p_credential_hash
  LIMIT 1;

  IF v_integration_id IS NULL THEN
    RETURN QUERY
    SELECT
      'invalid_integration_credential'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID;
    RETURN;
  END IF;

  IF v_status <> 'active' OR v_revoked_at IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'integration_revoked'::TEXT,
      v_integration_id,
      v_product_id,
      v_workspace_id;
    RETURN;
  END IF;

  IF v_understanding_status <> 'confirmed' THEN
    RETURN QUERY
    SELECT
      'integration_not_ready'::TEXT,
      v_integration_id,
      v_product_id,
      v_workspace_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id = v_workspace_id
      AND wc.capability = 'make_money'
      AND wc.status = 'active'
  ) THEN
    RETURN QUERY
    SELECT
      'make_money_not_active'::TEXT,
      v_integration_id,
      v_product_id,
      v_workspace_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'ok'::TEXT,
    v_integration_id,
    v_product_id,
    v_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_runtime_integration(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_runtime_integration(TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Event ingestion: persist Event + enqueue PGMQ message atomically
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
    btrim(p_idempotency_key),
    btrim(p_event_type),
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
    SELECT e.id
    INTO v_event_id
    FROM private.events AS e
    WHERE e.integration_id = p_integration_id
      AND e.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_event_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_accept_event(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_accept_event(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Event -> Moment worker
-- ---------------------------------------------------------------------------

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

  v_moment_key := pg_catalog.trim(
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

-- ---------------------------------------------------------------------------
-- Decision -> Delivery
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.runtime_create_decision_delivery(
  p_integration_id UUID,
  p_moment_key TEXT,
  p_request_id UUID,
  p_delivery_nonce TEXT,
  p_delivery_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  result_outcome TEXT,
  result_reason_code TEXT,
  result_decision_id UUID,
  result_delivery_id UUID,
  result_offer_id UUID,
  result_title TEXT,
  result_description TEXT,
  result_cta_label TEXT,
  result_destination_url TEXT,
  result_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_occurrence_id UUID;
  v_offer_id UUID;
  v_title TEXT;
  v_description TEXT;
  v_cta_label TEXT;
  v_destination_url TEXT;
  v_decision_id UUID;
  v_delivery_id UUID;
BEGIN
  IF p_moment_key IS NULL
     OR p_moment_key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
     OR length(p_moment_key) > 100
  THEN
    RAISE EXCEPTION 'invalid moment key' USING ERRCODE = '22023';
  END IF;

  SELECT i.product_id, p.workspace_id
  INTO v_product_id, v_workspace_id
  FROM public.integrations AS i
  JOIN public.products AS p
    ON p.id = i.product_id
  WHERE i.id = p_integration_id
    AND i.status = 'active'
    AND i.revoked_at IS NULL
    AND p.understanding_status = 'confirmed';

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'integration is not active' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id = v_workspace_id
      AND wc.capability = 'make_money'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'make_money capability is not active' USING ERRCODE = '42501';
  END IF;

  SELECT m.id
  INTO v_moment_id
  FROM public.moments AS m
  WHERE m.product_id = v_product_id
    AND m.moment_key = p_moment_key
    AND m.status = 'active'
  LIMIT 1;

  IF v_moment_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      NULL,
      NULL,
      p_integration_id,
      'no_fill',
      NULL,
      'moment_not_found',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'moment_not_found'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT mo.id
  INTO v_occurrence_id
  FROM private.moment_occurrences AS mo
  WHERE mo.integration_id = p_integration_id
    AND mo.moment_id = v_moment_id
    AND mo.occurred_at >= pg_catalog.clock_timestamp() - INTERVAL '10 minutes'
  ORDER BY mo.occurred_at DESC, mo.id DESC
  LIMIT 1;

  IF v_occurrence_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      v_moment_id,
      NULL,
      p_integration_id,
      'no_fill',
      NULL,
      'moment_occurrence_not_available',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'moment_occurrence_not_available'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT
    o.id,
    o.title,
    o.description,
    o.cta_label,
    o.destination_url
  INTO
    v_offer_id,
    v_title,
    v_description,
    v_cta_label,
    v_destination_url
  FROM public.offer_moments AS om
  JOIN public.offers AS o
    ON o.id = om.offer_id
  JOIN public.workspace_capabilities AS wc
    ON wc.workspace_id = o.workspace_id
   AND wc.capability = 'reach_customers'
   AND wc.status = 'active'
  JOIN private.advertiser_credit_accounts AS aca
    ON aca.workspace_id = o.workspace_id
   AND aca.available_units > 0
  WHERE om.moment_id = v_moment_id
    AND o.status = 'active'
    AND o.workspace_id <> v_workspace_id
  ORDER BY o.created_at DESC, o.id
  LIMIT 1;

  IF v_offer_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      v_moment_id,
      v_occurrence_id,
      p_integration_id,
      'no_fill',
      NULL,
      'no_eligible_offer',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'no_eligible_offer'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_delivery_nonce IS NULL
     OR length(p_delivery_nonce) < 16
     OR length(p_delivery_nonce) > 200
     OR p_delivery_token_hash IS NULL
     OR p_delivery_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
  THEN
    RAISE EXCEPTION 'delivery token metadata is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.decisions (
    moment_id,
    moment_occurrence_id,
    integration_id,
    outcome,
    offer_id,
    reason_code,
    request_id
  )
  VALUES (
    v_moment_id,
    v_occurrence_id,
    p_integration_id,
    'filled',
    v_offer_id,
    NULL,
    p_request_id
  )
  RETURNING id INTO v_decision_id;

  INSERT INTO private.deliveries (
    decision_id,
    offer_id,
    integration_id,
    delivery_nonce,
    delivery_token_hash,
    expires_at
  )
  VALUES (
    v_decision_id,
    v_offer_id,
    p_integration_id,
    p_delivery_nonce,
    p_delivery_token_hash,
    p_expires_at
  )
  RETURNING id INTO v_delivery_id;

  RETURN QUERY
  SELECT
    'filled'::TEXT,
    NULL::TEXT,
    v_decision_id,
    v_delivery_id,
    v_offer_id,
    v_title,
    v_description,
    v_cta_label,
    v_destination_url,
    p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_create_decision_delivery(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_create_decision_delivery(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

-- ---------------------------------------------------------------------------
-- Queue worker
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.runtime_worker_tick(
  p_quantity INTEGER DEFAULT 20,
  p_visibility_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  result_processed INTEGER,
  result_failed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message RECORD;
  v_event_id UUID;
  v_processed INTEGER := 0;
  v_failed INTEGER := 0;
  v_deleted BOOLEAN;
BEGIN
  IF p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'invalid worker quantity' USING ERRCODE = '22023';
  END IF;

  IF p_visibility_seconds < 5 OR p_visibility_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid worker visibility' USING ERRCODE = '22023';
  END IF;

  FOR v_message IN
    SELECT msg_id, message
    FROM pgmq.read('runtime-events', p_visibility_seconds, p_quantity)
  LOOP
    BEGIN
      v_event_id := NULLIF(v_message.message->>'event_id', '')::UUID;

      IF v_event_id IS NULL THEN
        v_deleted := pgmq.delete('runtime-events', v_message.msg_id);
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      PERFORM public.runtime_process_event(v_event_id);

      v_deleted := pgmq.delete('runtime-events', v_message.msg_id);

      IF v_deleted THEN
        v_processed := v_processed + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'P0002' THEN
        v_deleted := pgmq.delete('runtime-events', v_message.msg_id);
        v_failed := v_failed + 1;
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_worker_tick(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_worker_tick(INTEGER, INTEGER)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Scheduler
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'nextaction-runtime-worker'
  ) THEN
    PERFORM cron.schedule(
      'nextaction-runtime-worker',
      '* * * * *',
      'SELECT public.runtime_worker_tick(20, 60);'
    );
  END IF;
END
$$;

-- Queue schema remains an internal server boundary.
REVOKE ALL ON SCHEMA pgmq FROM PUBLIC, anon, authenticated;

COMMIT;
