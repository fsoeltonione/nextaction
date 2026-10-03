-- NextAction Stage 17 post-apply correction.
-- The smoke verifier must use private.clicks.clicked_at, not created_at.
BEGIN;

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

REVOKE ALL ON FUNCTION public.production_smoke_fixture_verify(
  UUID,
  UUID
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_verify(
  UUID,
  UUID
)
  TO service_role;

COMMIT;