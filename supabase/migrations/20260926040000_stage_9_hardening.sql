-- NextAction Stage 9 hardening/reconciliation
-- Aligns runtime semantics with Product Truth:
-- - advertisers may target active Moments from other workspaces
-- - /v1/offer is Moment-driven and must not wait for async Event processing
-- - Event idempotency rejects reuse with different payload semantics
-- Runtime chain remains Event -> Moment -> Decision -> Delivery.
BEGIN;

DROP TRIGGER IF EXISTS trg_validate_offer_moment_tenant ON public.offer_moments;
DROP FUNCTION IF EXISTS private.validate_offer_moment_tenant();

CREATE OR REPLACE FUNCTION public.create_offer_activation(
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_moment_ids UUID[]
)
RETURNS TABLE (result_workspace_id UUID, result_offer_id UUID, result_moment_count INTEGER)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_offer_id UUID;
  v_moment_count INTEGER;
  v_input_count INTEGER;
  v_target_keys TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;

  IF p_title IS NULL OR length(btrim(p_title)) < 1 OR length(p_title) > 160 THEN
    RAISE EXCEPTION 'invalid offer title' USING ERRCODE='22023';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'offer description is too long' USING ERRCODE='22023';
  END IF;

  IF p_cta_label IS NULL OR length(btrim(p_cta_label)) < 1 OR length(p_cta_label) > 80 THEN
    RAISE EXCEPTION 'invalid call to action label' USING ERRCODE='22023';
  END IF;

  IF p_destination_url IS NULL OR length(btrim(p_destination_url)) > 2048
     OR p_destination_url !~* '^https?://[^/?#]+(?:/[^?#]*)?$'
     OR p_destination_url ~ '[?#]' THEN
    RAISE EXCEPTION 'invalid destination URL' USING ERRCODE='22023';
  END IF;

  IF p_moment_ids IS NULL OR cardinality(p_moment_ids) < 1 OR cardinality(p_moment_ids) > 20 THEN
    RAISE EXCEPTION 'one to twenty target moments are required' USING ERRCODE='22023';
  END IF;

  v_input_count := cardinality(p_moment_ids);

  IF (SELECT count(DISTINCT x) FROM unnest(p_moment_ids) AS t(x)) <> v_input_count THEN
    RAISE EXCEPTION 'duplicate target moment is not allowed' USING ERRCODE='23505';
  END IF;

  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members AS wm
  WHERE wm.user_id = v_user_id
  ORDER BY (wm.role = 'owner') DESC, wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id = v_workspace_id
      AND wc.capability = 'reach_customers'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'reach_customers capability is not active' USING ERRCODE='42501';
  END IF;

  SELECT count(*), array_agg(m.moment_key ORDER BY m.moment_key)
  INTO v_moment_count, v_target_keys
  FROM public.moments AS m
  JOIN public.products AS p ON p.id = m.product_id
  WHERE m.id = ANY(p_moment_ids)
    AND m.status = 'active';

  IF v_moment_count <> v_input_count THEN
    RAISE EXCEPTION 'one or more target moments are invalid or inactive' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.offers AS o (
    workspace_id, title, description, cta_label, cta_url,
    target_moments, status, destination_url, updated_at
  )
  VALUES (
    v_workspace_id,
    btrim(p_title),
    NULLIF(btrim(p_description), ''),
    btrim(p_cta_label),
    p_destination_url,
    v_target_keys,
    'active',
    p_destination_url,
    timezone('utc'::text, now())
  )
  RETURNING o.id INTO v_offer_id;

  INSERT INTO public.offer_moments (offer_id, moment_id)
  SELECT v_offer_id, ids.x
  FROM unnest(p_moment_ids) AS ids(x);

  RETURN QUERY SELECT v_workspace_id, v_offer_id, v_moment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.runtime_accept_event(
  p_integration_id UUID,
  p_idempotency_key TEXT,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_payload JSONB,
  p_request_id UUID
)
RETURNS TABLE (result_event_id UUID, result_created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
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
    RAISE EXCEPTION 'integration is required' USING ERRCODE='22023';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE='22023';
  END IF;

  IF p_event_type IS NULL
     OR p_event_type !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN
    RAISE EXCEPTION 'invalid event type' USING ERRCODE='22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'event data must be an object' USING ERRCODE='22023';
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
    RAISE EXCEPTION 'integration is not active' USING ERRCODE='42501';
  END IF;

  INSERT INTO private.events(
    integration_id, idempotency_key, event_type, occurred_at, payload, request_id
  )
  VALUES(
    p_integration_id, btrim(p_idempotency_key), btrim(p_event_type),
    p_occurred_at, p_payload, p_request_id
  )
  ON CONFLICT(integration_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    v_created := TRUE;
    PERFORM pgmq.send(
      'runtime-events',
      pg_catalog.jsonb_build_object('event_id', v_event_id::TEXT)
    );
  ELSE
    SELECT e.id, e.event_type, e.occurred_at, e.payload
    INTO v_event_id, v_existing_event_type, v_existing_occurred_at, v_existing_payload
    FROM private.events AS e
    WHERE e.integration_id = p_integration_id
      AND e.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF v_existing_event_type IS DISTINCT FROM btrim(p_event_type)
       OR v_existing_occurred_at IS DISTINCT FROM p_occurred_at
       OR v_existing_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'idempotency key was already used with different event data'
        USING ERRCODE='23505';
    END IF;
  END IF;

  RETURN QUERY SELECT v_event_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_accept_event(UUID,TEXT,TEXT,TIMESTAMPTZ,JSONB,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_accept_event(UUID,TEXT,TEXT,TIMESTAMPTZ,JSONB,UUID)
  TO service_role;

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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
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
     OR length(p_moment_key) > 100 THEN
    RAISE EXCEPTION 'invalid moment key' USING ERRCODE='22023';
  END IF;

  SELECT i.product_id, p.workspace_id
  INTO v_product_id, v_workspace_id
  FROM public.integrations i
  JOIN public.products p ON p.id=i.product_id
  WHERE i.id=p_integration_id
    AND i.status='active'
    AND i.revoked_at IS NULL
    AND p.understanding_status='confirmed';

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'integration is not active' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.workspace_capabilities wc
    WHERE wc.workspace_id=v_workspace_id
      AND wc.capability='make_money'
      AND wc.status='active'
  ) THEN
    RAISE EXCEPTION 'make_money capability is not active' USING ERRCODE='42501';
  END IF;

  SELECT m.id INTO v_moment_id
  FROM public.moments m
  WHERE m.product_id=v_product_id
    AND m.moment_key=p_moment_key
    AND m.status='active'
  LIMIT 1;

  IF v_moment_id IS NULL THEN
    INSERT INTO private.decisions(
      moment_id,moment_occurrence_id,integration_id,outcome,offer_id,reason_code,request_id
    )
    VALUES(NULL,NULL,p_integration_id,'no_fill',NULL,'moment_not_found',p_request_id)
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT 'no_fill'::TEXT,'moment_not_found'::TEXT,v_decision_id,NULL::UUID,NULL::UUID,
      NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Event processing is asynchronous. Attach a recent occurrence when available,
  -- but never block a valid Moment decision on worker completion.
  SELECT mo.id INTO v_occurrence_id
  FROM private.moment_occurrences mo
  WHERE mo.integration_id=p_integration_id
    AND mo.moment_id=v_moment_id
    AND mo.occurred_at >= pg_catalog.clock_timestamp()-interval '10 minutes'
  ORDER BY mo.occurred_at DESC,mo.id DESC
  LIMIT 1;

  SELECT o.id,o.title,o.description,o.cta_label,o.destination_url
  INTO v_offer_id,v_title,v_description,v_cta_label,v_destination_url
  FROM public.offer_moments om
  JOIN public.offers o ON o.id=om.offer_id
  JOIN public.workspace_capabilities wc
    ON wc.workspace_id=o.workspace_id
   AND wc.capability='reach_customers'
   AND wc.status='active'
  JOIN private.advertiser_credit_accounts aca
    ON aca.workspace_id=o.workspace_id
   AND aca.available_units>0
  WHERE om.moment_id=v_moment_id
    AND o.status='active'
    AND o.workspace_id<>v_workspace_id
  ORDER BY o.created_at DESC,o.id
  LIMIT 1;

  IF v_offer_id IS NULL THEN
    INSERT INTO private.decisions(
      moment_id,moment_occurrence_id,integration_id,outcome,offer_id,reason_code,request_id
    )
    VALUES(v_moment_id,v_occurrence_id,p_integration_id,'no_fill',NULL,'no_eligible_offer',p_request_id)
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT 'no_fill'::TEXT,'no_eligible_offer'::TEXT,v_decision_id,NULL::UUID,NULL::UUID,
      NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_delivery_nonce IS NULL OR length(p_delivery_nonce)<16 OR length(p_delivery_nonce)>200
     OR p_delivery_token_hash IS NULL OR p_delivery_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'delivery token metadata is invalid' USING ERRCODE='22023';
  END IF;

  INSERT INTO private.decisions(
    moment_id,moment_occurrence_id,integration_id,outcome,offer_id,reason_code,request_id
  )
  VALUES(v_moment_id,v_occurrence_id,p_integration_id,'filled',v_offer_id,NULL,p_request_id)
  RETURNING id INTO v_decision_id;

  INSERT INTO private.deliveries(
    decision_id,offer_id,integration_id,delivery_nonce,delivery_token_hash,expires_at
  )
  VALUES(v_decision_id,v_offer_id,p_integration_id,p_delivery_nonce,p_delivery_token_hash,p_expires_at)
  RETURNING id INTO v_delivery_id;

  RETURN QUERY
  SELECT 'filled'::TEXT,NULL::TEXT,v_decision_id,v_delivery_id,v_offer_id,
    v_title,v_description,v_cta_label,v_destination_url,p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_create_decision_delivery(UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_create_decision_delivery(UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ)
  TO service_role;

COMMIT;
