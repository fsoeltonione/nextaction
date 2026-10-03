-- NextAction Stage 17 final reconciliation for environments that already
-- applied an earlier Stage 17 revision.
BEGIN;

DO $reconcile17$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'settlements_qualified_click_id_key'
      AND conrelid = 'private.settlements'::regclass
      AND contype = 'u'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'settlements_qualified_click_id_key'
        AND n.nspname = 'private'
        AND c.relkind = 'i'
    ) THEN
      ALTER TABLE private.settlements
        ADD CONSTRAINT settlements_qualified_click_id_key
        UNIQUE USING INDEX settlements_qualified_click_id_key;
    ELSE
      ALTER TABLE private.settlements
        ADD CONSTRAINT settlements_qualified_click_id_key
        UNIQUE (qualified_click_id);
    END IF;
  END IF;
END
$reconcile17$;

CREATE OR REPLACE FUNCTION public.runtime_click_qualify_and_settle(
  p_delivery_token_hash TEXT
)
RETURNS TABLE (
  result_outcome TEXT,
  result_click_id UUID,
  result_qualification_status TEXT,
  result_destination_url TEXT,
  result_reason_code TEXT,
  result_qualified_click_id UUID,
  result_qualification_version TEXT,
  result_qualified_at TIMESTAMPTZ,
  result_settlement_outcome TEXT,
  result_settlement_id UUID,
  result_advertiser_workspace_id UUID,
  result_publisher_workspace_id UUID,
  result_charge_cents INTEGER,
  result_publisher_share_cents INTEGER,
  result_platform_share_cents INTEGER,
  result_currency TEXT,
  result_remaining_capacity INTEGER,
  result_settlement_reason_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $click17$
DECLARE
  v_qualify_result RECORD;
  v_settle_result RECORD;
BEGIN
  SELECT *
  INTO v_qualify_result
  FROM public.runtime_record_and_qualify_click(p_delivery_token_hash)
  LIMIT 1;

  IF v_qualify_result.result_qualified_click_id IS NULL THEN
    RETURN QUERY
    SELECT
      v_qualify_result.result_outcome,
      v_qualify_result.result_click_id,
      v_qualify_result.result_qualification_status,
      v_qualify_result.result_destination_url,
      v_qualify_result.result_reason_code,
      v_qualify_result.result_qualified_click_id,
      v_qualify_result.result_qualification_version,
      v_qualify_result.result_qualified_at,
      NULL::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::TEXT,
      NULL::INTEGER,
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_settle_result
  FROM public.runtime_settle_qualified_click(
    v_qualify_result.result_qualified_click_id
  )
  LIMIT 1;

  -- System-side settlement failures must roll back the qualification and
  -- click writes so a later retry can perform the complete transition again.
  -- no_capacity is intentionally a committed, retryable business outcome.
  IF v_settle_result.result_outcome IN (
    'not_found',
    'not_qualified',
    'financial_unavailable'
  ) THEN
    RAISE EXCEPTION 'atomic click settlement did not complete: %',
      v_settle_result.result_outcome
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    v_qualify_result.result_outcome,
    v_qualify_result.result_click_id,
    v_qualify_result.result_qualification_status,
    v_qualify_result.result_destination_url,
    v_qualify_result.result_reason_code,
    v_qualify_result.result_qualified_click_id,
    v_qualify_result.result_qualification_version,
    v_qualify_result.result_qualified_at,
    v_settle_result.result_outcome,
    v_settle_result.result_settlement_id,
    v_settle_result.result_advertiser_workspace_id,
    v_settle_result.result_publisher_workspace_id,
    v_settle_result.result_charge_cents,
    v_settle_result.result_publisher_share_cents,
    v_settle_result.result_platform_share_cents,
    v_settle_result.result_currency,
    v_settle_result.result_remaining_capacity,
    v_settle_result.result_reason_code;
END;
$click17$;

REVOKE ALL ON FUNCTION public.runtime_click_qualify_and_settle(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_click_qualify_and_settle(TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.runtime_get_workspace_balance(
  p_workspace_id UUID
)
RETURNS TABLE (
  result_available_units INTEGER,
  result_currency TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $balance17$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace id is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(a.available_units, 0),
    'USD'::TEXT
  FROM private.advertiser_credit_accounts AS a
  WHERE a.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 0::INTEGER, 'USD'::TEXT;
  END IF;
END;
$balance17$;

REVOKE ALL ON FUNCTION public.runtime_get_workspace_balance(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_get_workspace_balance(UUID)
  TO service_role;

DROP FUNCTION IF EXISTS public.production_smoke_fixture_create(TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_create(
  p_smoke_id TEXT,
  p_user_id UUID,
  p_credential_hash TEXT
)
RETURNS TABLE (
  result_publisher_workspace_id UUID,
  result_advertiser_workspace_id UUID,
  result_product_id UUID,
  result_moment_id UUID,
  result_integration_id UUID,
  result_offer_id UUID,
  result_moment_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fixture17$
DECLARE
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_integration_id UUID;
  v_offer_id UUID;
  v_moment_key TEXT;
  v_destination_url TEXT := 'https://example.com/?nextaction_production_smoke=1';
  v_suffix TEXT;
BEGIN
  IF p_smoke_id IS NULL OR p_smoke_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'invalid smoke id' USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid credential hash' USING ERRCODE = '22023';
  END IF;

  v_suffix := left(p_smoke_id, 24);
  v_moment_key := 'production_smoke_moment_' || v_suffix;

  -- Serialize creation of the two fixed hidden canary workspaces.
  PERFORM pg_catalog.pg_advisory_xact_lock(17003, 17);

  SELECT id
  INTO v_publisher_workspace_id
  FROM public.workspaces
  WHERE name = '__nextaction_prod_smoke_publisher'
  LIMIT 1;

  IF v_publisher_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, user_id, created_by)
    VALUES (
      '__nextaction_prod_smoke_publisher',
      p_user_id,
      p_user_id
    )
    RETURNING id INTO v_publisher_workspace_id;
  END IF;

  SELECT id
  INTO v_advertiser_workspace_id
  FROM public.workspaces
  WHERE name = '__nextaction_prod_smoke_advertiser'
  LIMIT 1;

  IF v_advertiser_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, user_id, created_by)
    VALUES (
      '__nextaction_prod_smoke_advertiser',
      p_user_id,
      p_user_id
    )
    RETURNING id INTO v_advertiser_workspace_id;
  END IF;

  INSERT INTO public.workspace_capabilities (
    workspace_id,
    capability,
    status
  )
  VALUES
    (v_publisher_workspace_id, 'make_money', 'active'),
    (v_advertiser_workspace_id, 'reach_customers', 'active')
  ON CONFLICT (workspace_id, capability)
  DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = pg_catalog.timezone('utc'::text, now());

  -- A stable product keeps the canary small; each smoke run gets unique
  -- Moment/Integration/Offer rows underneath the hidden publisher/advertiser
  -- workspaces.
  SELECT id
  INTO v_product_id
  FROM public.products
  WHERE workspace_id = v_publisher_workspace_id
    AND canonical_url = 'https://example.com'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO public.products (
      workspace_id,
      domain,
      name,
      description,
      canonical_url,
      understanding_status
    )
    VALUES (
      v_publisher_workspace_id,
      'example.com',
      'Production Smoke Publisher',
      'Persistent production HTTP smoke canary.',
      'https://example.com',
      'confirmed'
    )
    RETURNING id INTO v_product_id;
  END IF;

  INSERT INTO public.moments (
    product_id,
    moment_key,
    label,
    description,
    status
  )
  VALUES (
    v_product_id,
    v_moment_key,
    'Production Smoke Moment',
    'Persistent production HTTP smoke canary run.',
    'active'
  )
  RETURNING id INTO v_moment_id;

  INSERT INTO public.integrations (
    product_id,
    name,
    status
  )
  VALUES (
    v_product_id,
    'Production Smoke Integration ' || v_suffix,
    'active'
  )
  RETURNING id INTO v_integration_id;

  INSERT INTO private.integration_secrets (
    integration_id,
    credential_hash
  )
  VALUES (
    v_integration_id,
    p_credential_hash
  );

  INSERT INTO public.offers (
    workspace_id,
    title,
    description,
    cta_label,
    destination_url,
    target_moments,
    budget_cents,
    spent_cents,
    status,
    cta_url
  )
  VALUES (
    v_advertiser_workspace_id,
    'Production Smoke Offer ' || v_suffix,
    'Persistent production HTTP smoke canary run.',
    'Open smoke destination',
    v_destination_url,
    ARRAY[v_moment_key],
    0,
    0,
    'active',
    v_destination_url
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.offer_moments (
    offer_id,
    moment_id
  )
  VALUES (
    v_offer_id,
    v_moment_id
  );

  INSERT INTO private.advertiser_credit_accounts (
    workspace_id,
    granted_units,
    consumed_units,
    available_units
  )
  VALUES (
    v_advertiser_workspace_id,
    1,
    0,
    1
  )
  ON CONFLICT (workspace_id)
  DO UPDATE SET
    granted_units =
      private.advertiser_credit_accounts.granted_units + 1,
    available_units =
      private.advertiser_credit_accounts.available_units + 1,
    updated_at =
      pg_catalog.timezone('utc'::text, now());

  INSERT INTO private.advertiser_credit_entries (
    workspace_id,
    entry_type,
    units,
    reference_id
  )
  VALUES (
    v_advertiser_workspace_id,
    'grant',
    1,
    NULL
  );

  RETURN QUERY
  SELECT
    v_publisher_workspace_id,
    v_advertiser_workspace_id,
    v_product_id,
    v_moment_id,
    v_integration_id,
    v_offer_id,
    v_moment_key;
END;
$fixture17$;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_verify(
  p_integration_id UUID,
  p_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $verify17$
DECLARE
  v_product_id UUID;
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_moment_id UUID;
  v_occurrence_id UUID;
  v_decision_id UUID;
  v_delivery_id UUID;
  v_click_id UUID;
  v_qualified_click_id UUID;
  v_settlement_id UUID;
  v_queue_messages INTEGER := 0;
  v_decision_count INTEGER := 0;
  v_delivery_count INTEGER := 0;
  v_click_count INTEGER := 0;
  v_qualified_click_count INTEGER := 0;
  v_settlement_count INTEGER := 0;
  v_financial_entry_count INTEGER := 0;
  v_financial_debit_cents INTEGER := 0;
  v_financial_credit_cents INTEGER := 0;
  v_credit_consumption_entry_count INTEGER := 0;
  v_available_units INTEGER := 0;
  v_settlement_charge_cents INTEGER := 0;
  v_publisher_share_cents INTEGER := 0;
  v_platform_share_cents INTEGER := 0;
  v_currency TEXT;
  v_event_found BOOLEAN := FALSE;
  v_occurrence_found BOOLEAN := FALSE;
BEGIN
  IF p_integration_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'integration and event ids are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    i.product_id,
    p.workspace_id
  INTO
    v_product_id,
    v_publisher_workspace_id
  FROM public.integrations AS i
  JOIN public.products AS p
    ON p.id = i.product_id
  WHERE i.id = p_integration_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'smoke integration not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.id
  INTO v_moment_id
  FROM public.moments AS m
  WHERE m.product_id = v_product_id
    AND m.moment_key = (
      SELECT m2.moment_key
      FROM public.moments AS m2
      WHERE m2.id = (
        SELECT mo.moment_id
        FROM private.moment_occurrences AS mo
        WHERE mo.event_id = p_event_id
        LIMIT 1
      )
      LIMIT 1
    )
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM private.events AS e
    WHERE e.id = p_event_id
      AND e.integration_id = p_integration_id
  )
  INTO v_event_found;

  SELECT mo.id
  INTO v_occurrence_id
  FROM private.moment_occurrences AS mo
  WHERE mo.event_id = p_event_id
    AND mo.integration_id = p_integration_id
    AND (v_moment_id IS NULL OR mo.moment_id = v_moment_id)
  ORDER BY mo.occurred_at DESC, mo.id DESC
  LIMIT 1;

  v_occurrence_found := v_occurrence_id IS NOT NULL;

  SELECT count(*)::INTEGER
  INTO v_queue_messages
  FROM pgmq."q_runtime-events" AS q
  WHERE q.message->>'event_id' = p_event_id::TEXT;

  IF v_occurrence_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_decision_count
    FROM private.decisions
    WHERE integration_id = p_integration_id
      AND moment_occurrence_id = v_occurrence_id
      AND outcome = 'filled';

    SELECT d.id
    INTO v_decision_id
    FROM private.decisions AS d
    WHERE d.integration_id = p_integration_id
      AND d.moment_occurrence_id = v_occurrence_id
      AND d.outcome = 'filled'
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1;
  END IF;

  IF v_decision_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_delivery_count
    FROM private.deliveries
    WHERE decision_id = v_decision_id;

    SELECT d.id
    INTO v_delivery_id
    FROM private.deliveries AS d
    WHERE d.decision_id = v_decision_id
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1;
  END IF;

  IF v_delivery_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_click_count
    FROM private.clicks
    WHERE delivery_id = v_delivery_id;

    SELECT c.id
    INTO v_click_id
    FROM private.clicks AS c
    WHERE c.delivery_id = v_delivery_id
    ORDER BY c.clicked_at DESC, c.id DESC
    LIMIT 1;
  END IF;

  IF v_click_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_qualified_click_count
    FROM private.qualified_clicks
    WHERE click_id = v_click_id;

    SELECT qc.id
    INTO v_qualified_click_id
    FROM private.qualified_clicks AS qc
    WHERE qc.click_id = v_click_id
    ORDER BY qc.qualified_at DESC, qc.id DESC
    LIMIT 1;
  END IF;

  IF v_qualified_click_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_settlement_count
    FROM private.settlements
    WHERE qualified_click_id = v_qualified_click_id;

    SELECT
      s.id,
      s.advertiser_workspace_id,
      s.charge_cents,
      s.publisher_share_cents,
      s.platform_share_cents,
      s.currency
    INTO
      v_settlement_id,
      v_advertiser_workspace_id,
      v_settlement_charge_cents,
      v_publisher_share_cents,
      v_platform_share_cents,
      v_currency
    FROM private.settlements AS s
    WHERE s.qualified_click_id = v_qualified_click_id
    ORDER BY s.settled_at DESC, s.id DESC
    LIMIT 1;
  END IF;

  IF v_settlement_id IS NOT NULL THEN
    SELECT
      count(*)::INTEGER,
      COALESCE(
        sum(amount_cents) FILTER (WHERE entry_type = 'debit'),
        0
      )::INTEGER,
      COALESCE(
        sum(amount_cents) FILTER (WHERE entry_type = 'credit'),
        0
      )::INTEGER
    INTO
      v_financial_entry_count,
      v_financial_debit_cents,
      v_financial_credit_cents
    FROM private.financial_entries
    WHERE settlement_id = v_settlement_id;

    SELECT count(*)::INTEGER
    INTO v_credit_consumption_entry_count
    FROM private.advertiser_credit_entries
    WHERE workspace_id = v_advertiser_workspace_id
      AND entry_type = 'consumption'
      AND reference_id = v_settlement_id;
  END IF;

  IF v_advertiser_workspace_id IS NOT NULL THEN
    SELECT COALESCE(available_units, 0)
    INTO v_available_units
    FROM private.advertiser_credit_accounts
    WHERE workspace_id = v_advertiser_workspace_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'event_found', v_event_found,
    'occurrence_found', v_occurrence_found,
    'queue_messages_for_event', v_queue_messages,
    'decision_count', v_decision_count,
    'delivery_count', v_delivery_count,
    'click_count', v_click_count,
    'qualified_click_count', v_qualified_click_count,
    'settlement_count', v_settlement_count,
    'financial_entry_count', v_financial_entry_count,
    'settlement_charge_cents', v_settlement_charge_cents,
    'publisher_share_cents', v_publisher_share_cents,
    'platform_share_cents', v_platform_share_cents,
    'currency', v_currency,
    'financial_debit_cents', v_financial_debit_cents,
    'financial_credit_cents', v_financial_credit_cents,
    'credit_consumption_entry_count', v_credit_consumption_entry_count,
    'credit_available_units', v_available_units,
    'event_id', p_event_id,
    'integration_id', p_integration_id
  );
END;
$verify17$;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_verify(
  p_integration_id UUID,
  p_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $verify17$
DECLARE
  v_product_id UUID;
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_moment_id UUID;
  v_occurrence_id UUID;
  v_decision_id UUID;
  v_delivery_id UUID;
  v_click_id UUID;
  v_qualified_click_id UUID;
  v_settlement_id UUID;
  v_queue_messages INTEGER := 0;
  v_decision_count INTEGER := 0;
  v_delivery_count INTEGER := 0;
  v_click_count INTEGER := 0;
  v_qualified_click_count INTEGER := 0;
  v_settlement_count INTEGER := 0;
  v_financial_entry_count INTEGER := 0;
  v_financial_debit_cents INTEGER := 0;
  v_financial_credit_cents INTEGER := 0;
  v_credit_consumption_entry_count INTEGER := 0;
  v_available_units INTEGER := 0;
  v_settlement_charge_cents INTEGER := 0;
  v_publisher_share_cents INTEGER := 0;
  v_platform_share_cents INTEGER := 0;
  v_currency TEXT;
  v_event_found BOOLEAN := FALSE;
  v_occurrence_found BOOLEAN := FALSE;
BEGIN
  IF p_integration_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'integration and event ids are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    i.product_id,
    p.workspace_id
  INTO
    v_product_id,
    v_publisher_workspace_id
  FROM public.integrations AS i
  JOIN public.products AS p
    ON p.id = i.product_id
  WHERE i.id = p_integration_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'smoke integration not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.id
  INTO v_moment_id
  FROM public.moments AS m
  WHERE m.product_id = v_product_id
    AND m.moment_key = (
      SELECT m2.moment_key
      FROM public.moments AS m2
      WHERE m2.id = (
        SELECT mo.moment_id
        FROM private.moment_occurrences AS mo
        WHERE mo.event_id = p_event_id
        LIMIT 1
      )
      LIMIT 1
    )
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM private.events AS e
    WHERE e.id = p_event_id
      AND e.integration_id = p_integration_id
  )
  INTO v_event_found;

  SELECT mo.id
  INTO v_occurrence_id
  FROM private.moment_occurrences AS mo
  WHERE mo.event_id = p_event_id
    AND mo.integration_id = p_integration_id
    AND (v_moment_id IS NULL OR mo.moment_id = v_moment_id)
  ORDER BY mo.occurred_at DESC, mo.id DESC
  LIMIT 1;

  v_occurrence_found := v_occurrence_id IS NOT NULL;

  SELECT count(*)::INTEGER
  INTO v_queue_messages
  FROM pgmq."q_runtime-events" AS q
  WHERE q.message->>'event_id' = p_event_id::TEXT;

  IF v_occurrence_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_decision_count
    FROM private.decisions
    WHERE integration_id = p_integration_id
      AND moment_occurrence_id = v_occurrence_id
      AND outcome = 'filled';

    SELECT d.id
    INTO v_decision_id
    FROM private.decisions AS d
    WHERE d.integration_id = p_integration_id
      AND d.moment_occurrence_id = v_occurrence_id
      AND d.outcome = 'filled'
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1;
  END IF;

  IF v_decision_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_delivery_count
    FROM private.deliveries
    WHERE decision_id = v_decision_id;

    SELECT d.id
    INTO v_delivery_id
    FROM private.deliveries AS d
    WHERE d.decision_id = v_decision_id
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1;
  END IF;

  IF v_delivery_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_click_count
    FROM private.clicks
    WHERE delivery_id = v_delivery_id;

    SELECT c.id
    INTO v_click_id
    FROM private.clicks AS c
    WHERE c.delivery_id = v_delivery_id
    ORDER BY c.clicked_at DESC, c.id DESC
    LIMIT 1;
  END IF;

  IF v_click_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_qualified_click_count
    FROM private.qualified_clicks
    WHERE click_id = v_click_id;

    SELECT qc.id
    INTO v_qualified_click_id
    FROM private.qualified_clicks AS qc
    WHERE qc.click_id = v_click_id
    ORDER BY qc.qualified_at DESC, qc.id DESC
    LIMIT 1;
  END IF;

  IF v_qualified_click_id IS NOT NULL THEN
    SELECT count(*)::INTEGER
    INTO v_settlement_count
    FROM private.settlements
    WHERE qualified_click_id = v_qualified_click_id;

    SELECT
      s.id,
      s.advertiser_workspace_id,
      s.charge_cents,
      s.publisher_share_cents,
      s.platform_share_cents,
      s.currency
    INTO
      v_settlement_id,
      v_advertiser_workspace_id,
      v_settlement_charge_cents,
      v_publisher_share_cents,
      v_platform_share_cents,
      v_currency
    FROM private.settlements AS s
    WHERE s.qualified_click_id = v_qualified_click_id
    ORDER BY s.settled_at DESC, s.id DESC
    LIMIT 1;
  END IF;

  IF v_settlement_id IS NOT NULL THEN
    SELECT
      count(*)::INTEGER,
      COALESCE(
        sum(amount_cents) FILTER (WHERE entry_type = 'debit'),
        0
      )::INTEGER,
      COALESCE(
        sum(amount_cents) FILTER (WHERE entry_type = 'credit'),
        0
      )::INTEGER
    INTO
      v_financial_entry_count,
      v_financial_debit_cents,
      v_financial_credit_cents
    FROM private.financial_entries
    WHERE settlement_id = v_settlement_id;

    SELECT count(*)::INTEGER
    INTO v_credit_consumption_entry_count
    FROM private.advertiser_credit_entries
    WHERE workspace_id = v_advertiser_workspace_id
      AND entry_type = 'consumption'
      AND reference_id = v_settlement_id;
  END IF;

  IF v_advertiser_workspace_id IS NOT NULL THEN
    SELECT COALESCE(available_units, 0)
    INTO v_available_units
    FROM private.advertiser_credit_accounts
    WHERE workspace_id = v_advertiser_workspace_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'event_found', v_event_found,
    'occurrence_found', v_occurrence_found,
    'queue_messages_for_event', v_queue_messages,
    'decision_count', v_decision_count,
    'delivery_count', v_delivery_count,
    'click_count', v_click_count,
    'qualified_click_count', v_qualified_click_count,
    'settlement_count', v_settlement_count,
    'financial_entry_count', v_financial_entry_count,
    'settlement_charge_cents', v_settlement_charge_cents,
    'publisher_share_cents', v_publisher_share_cents,
    'platform_share_cents', v_platform_share_cents,
    'currency', v_currency,
    'financial_debit_cents', v_financial_debit_cents,
    'financial_credit_cents', v_financial_credit_cents,
    'credit_consumption_entry_count', v_credit_consumption_entry_count,
    'credit_available_units', v_available_units,
    'event_id', p_event_id,
    'integration_id', p_integration_id
  );
END;
$verify17$;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_verify(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_verify(UUID, UUID)
  TO service_role;

COMMIT;