-- Stage 15 post-release hardening:
-- service-role-only production smoke fixture harness.
--
-- The harness creates an isolated, short-lived publisher/advertiser pair,
-- verifies the live runtime chain, and removes the fixture. It is deliberately
-- unavailable to anon/authenticated callers.

BEGIN;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_create(
  p_smoke_id TEXT,
  p_user_id UUID,
  p_credential_hash TEXT,
  p_destination_url TEXT
)
RETURNS TABLE(
  publisher_workspace_id UUID,
  advertiser_workspace_id UUID,
  product_id UUID,
  moment_id UUID,
  integration_id UUID,
  offer_id UUID,
  moment_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_integration_id UUID;
  v_offer_id UUID;
  v_moment_key TEXT;
  v_prefix TEXT;
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

  IF p_destination_url IS NULL OR p_destination_url !~ '^https?://' THEN
    RAISE EXCEPTION 'invalid destination URL' USING ERRCODE = '22023';
  END IF;

  v_prefix := '__nextaction_smoke_' || p_smoke_id;
  v_moment_key := 'production_smoke_' || left(p_smoke_id, 24);

  INSERT INTO public.workspaces (name, user_id, created_by)
  VALUES
    (v_prefix || '_publisher', p_user_id, p_user_id),
    (v_prefix || '_advertiser', p_user_id, p_user_id)
  RETURNING id, id
  INTO v_publisher_workspace_id, v_advertiser_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES
    (v_publisher_workspace_id, p_user_id, 'owner'),
    (v_advertiser_workspace_id, p_user_id, 'owner');

  INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
  VALUES
    (v_publisher_workspace_id, 'make_money', 'active'),
    (v_advertiser_workspace_id, 'reach_customers', 'active');

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
    'Production Smoke Publisher ' || left(p_smoke_id, 8),
    'Ephemeral production smoke fixture.',
    'https://example.com',
    'confirmed'
  )
  RETURNING id INTO v_product_id;

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
    'Ephemeral production smoke fixture moment.',
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
    'Production Smoke Integration ' || left(p_smoke_id, 8),
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
    cta_url,
    target_moments,
    budget_cents,
    spent_cents,
    status,
    destination_url
  )
  VALUES (
    v_advertiser_workspace_id,
    'Production Smoke Offer ' || left(p_smoke_id, 8),
    'Ephemeral production smoke fixture offer.',
    'Open smoke destination',
    p_destination_url,
    ARRAY[v_moment_key],
    100,
    0,
    'active',
    p_destination_url
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.offer_moments (offer_id, moment_id)
  VALUES (v_offer_id, v_moment_id);

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
  );

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
$$;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_verify(
  p_smoke_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix TEXT;
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_integration_id UUID;
  v_offer_id UUID;
  v_event_id UUID;
  v_qualified_click_id UUID;
  v_settlement_id UUID;
  v_result JSONB;
BEGIN
  IF p_smoke_id IS NULL OR p_smoke_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'invalid smoke id' USING ERRCODE = '22023';
  END IF;

  v_prefix := '__nextaction_smoke_' || p_smoke_id;

  SELECT w.id
  INTO v_publisher_workspace_id
  FROM public.workspaces AS w
  WHERE w.name = v_prefix || '_publisher'
  LIMIT 1;

  SELECT w.id
  INTO v_advertiser_workspace_id
  FROM public.workspaces AS w
  WHERE w.name = v_prefix || '_advertiser'
  LIMIT 1;

  IF v_publisher_workspace_id IS NULL OR v_advertiser_workspace_id IS NULL THEN
    RAISE EXCEPTION 'production smoke fixture not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.id
  INTO v_product_id
  FROM public.products AS p
  WHERE p.workspace_id = v_publisher_workspace_id
  LIMIT 1;

  SELECT m.id
  INTO v_moment_id
  FROM public.moments AS m
  WHERE m.product_id = v_product_id
  LIMIT 1;

  SELECT i.id
  INTO v_integration_id
  FROM public.integrations AS i
  WHERE i.product_id = v_product_id
  LIMIT 1;

  SELECT o.id
  INTO v_offer_id
  FROM public.offers AS o
  WHERE o.workspace_id = v_advertiser_workspace_id
  LIMIT 1;

  SELECT e.id
  INTO v_event_id
  FROM private.events AS e
  WHERE e.integration_id = v_integration_id
  ORDER BY e.received_at DESC, e.id DESC
  LIMIT 1;

  SELECT qc.id
  INTO v_qualified_click_id
  FROM private.qualified_clicks AS qc
  JOIN private.clicks AS c ON c.id = qc.click_id
  JOIN private.deliveries AS d ON d.id = c.delivery_id
  WHERE d.integration_id = v_integration_id
  ORDER BY qc.qualified_at DESC, qc.id DESC
  LIMIT 1;

  SELECT s.id
  INTO v_settlement_id
  FROM private.settlements AS s
  WHERE s.qualified_click_id = v_qualified_click_id
  LIMIT 1;

  SELECT jsonb_build_object(
    'workspaces', (SELECT count(*) FROM public.workspaces WHERE name IN (v_prefix || '_publisher', v_prefix || '_advertiser')),
    'products', (SELECT count(*) FROM public.products WHERE workspace_id = v_publisher_workspace_id),
    'moments', (SELECT count(*) FROM public.moments WHERE product_id = v_product_id),
    'integrations', (SELECT count(*) FROM public.integrations WHERE product_id = v_product_id),
    'offers', (SELECT count(*) FROM public.offers WHERE workspace_id = v_advertiser_workspace_id),
    'events', (SELECT count(*) FROM private.events WHERE integration_id = v_integration_id),
    'processed_events', (SELECT count(*) FROM private.events WHERE integration_id = v_integration_id AND processing_status = 'processed'),
    'moment_occurrences', (SELECT count(*) FROM private.moment_occurrences WHERE integration_id = v_integration_id),
    'decisions', (SELECT count(*) FROM private.decisions WHERE integration_id = v_integration_id),
    'deliveries', (SELECT count(*) FROM private.deliveries WHERE integration_id = v_integration_id),
    'clicks', (SELECT count(*) FROM private.clicks WHERE delivery_id IN (SELECT d.id FROM private.deliveries AS d WHERE d.integration_id = v_integration_id)),
    'qualified_clicks', (SELECT count(*) FROM private.qualified_clicks WHERE click_id IN (
      SELECT c.id FROM private.clicks AS c
      JOIN private.deliveries AS d ON d.id = c.delivery_id
      WHERE d.integration_id = v_integration_id
    )),
    'settlements', (SELECT count(*) FROM private.settlements WHERE advertiser_workspace_id = v_advertiser_workspace_id AND publisher_workspace_id = v_publisher_workspace_id),
    'financial_entries', (SELECT count(*) FROM private.financial_entries WHERE settlement_id IN (
      SELECT s.id FROM private.settlements AS s
      WHERE s.advertiser_workspace_id = v_advertiser_workspace_id AND s.publisher_workspace_id = v_publisher_workspace_id
    )),
    'queue_messages_for_event', CASE
      WHEN v_event_id IS NULL THEN 0
      ELSE (SELECT count(*) FROM pgmq."q_runtime-events" WHERE message->>'event_id' = v_event_id::TEXT)
    END,
    'split_mismatch', (SELECT count(*) FROM private.settlements
      WHERE advertiser_workspace_id = v_advertiser_workspace_id
        AND publisher_workspace_id = v_publisher_workspace_id
        AND (charge_cents <> publisher_share_cents + platform_share_cents
          OR charge_cents <> 100
          OR publisher_share_cents <> 75
          OR platform_share_cents <> 25
          OR currency <> 'USD')),
    'ledger_mismatch', (SELECT count(*)
      FROM private.settlements AS s
      WHERE s.id = v_settlement_id
        AND (
          (SELECT count(*) FROM private.financial_entries AS fe WHERE fe.settlement_id = s.id) <> 3
          OR (SELECT coalesce(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'debit'), 0) FROM private.financial_entries AS fe WHERE fe.settlement_id = s.id) <> s.charge_cents
          OR (SELECT coalesce(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'credit'), 0) FROM private.financial_entries AS fe WHERE fe.settlement_id = s.id) <> s.charge_cents
        )
    ),
    'credit_available_units', (SELECT available_units FROM private.advertiser_credit_accounts WHERE workspace_id = v_advertiser_workspace_id),
    'event_id', v_event_id,
    'qualified_click_id', v_qualified_click_id,
    'settlement_id', v_settlement_id,
    'product_id', v_product_id,
    'moment_id', v_moment_id,
    'integration_id', v_integration_id,
    'offer_id', v_offer_id
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_cleanup(
  p_smoke_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix TEXT;
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_product_id UUID;
  v_integration_id UUID;
  v_offer_id UUID;
  v_remaining_workspaces INTEGER;
BEGIN
  IF p_smoke_id IS NULL OR p_smoke_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'invalid smoke id' USING ERRCODE = '22023';
  END IF;

  v_prefix := '__nextaction_smoke_' || p_smoke_id;

  SELECT w.id
  INTO v_publisher_workspace_id
  FROM public.workspaces AS w
  WHERE w.name = v_prefix || '_publisher'
  LIMIT 1;

  SELECT w.id
  INTO v_advertiser_workspace_id
  FROM public.workspaces AS w
  WHERE w.name = v_prefix || '_advertiser'
  LIMIT 1;

  SELECT p.id
  INTO v_product_id
  FROM public.products AS p
  WHERE p.workspace_id = v_publisher_workspace_id
  LIMIT 1;

  SELECT i.id
  INTO v_integration_id
  FROM public.integrations AS i
  WHERE i.product_id = v_product_id
  LIMIT 1;

  SELECT o.id
  INTO v_offer_id
  FROM public.offers AS o
  WHERE o.workspace_id = v_advertiser_workspace_id
  LIMIT 1;

  DELETE FROM private.financial_entries
  WHERE settlement_id IN (
    SELECT s.id
    FROM private.settlements AS s
    WHERE s.advertiser_workspace_id IN (v_advertiser_workspace_id, v_publisher_workspace_id)
       OR s.publisher_workspace_id IN (v_advertiser_workspace_id, v_publisher_workspace_id)
  );

  DELETE FROM private.settlements
  WHERE advertiser_workspace_id IN (v_advertiser_workspace_id, v_publisher_workspace_id)
     OR publisher_workspace_id IN (v_advertiser_workspace_id, v_publisher_workspace_id);

  DELETE FROM private.qualified_clicks
  WHERE click_id IN (
    SELECT c.id
    FROM private.clicks AS c
    JOIN private.deliveries AS d ON d.id = c.delivery_id
    WHERE d.integration_id = v_integration_id
  );

  DELETE FROM private.clicks
  WHERE delivery_id IN (
    SELECT d.id FROM private.deliveries AS d WHERE d.integration_id = v_integration_id
  );

  DELETE FROM private.deliveries
  WHERE integration_id = v_integration_id;

  DELETE FROM private.decisions
  WHERE integration_id = v_integration_id;

  DELETE FROM private.moment_occurrences
  WHERE integration_id = v_integration_id;

  DELETE FROM private.events
  WHERE integration_id = v_integration_id;

  DELETE FROM private.advertiser_credit_entries
  WHERE workspace_id = v_advertiser_workspace_id;

  DELETE FROM private.advertiser_credit_accounts
  WHERE workspace_id = v_advertiser_workspace_id;

  DELETE FROM private.financial_accounts
  WHERE workspace_id IN (v_publisher_workspace_id, v_advertiser_workspace_id);

  DELETE FROM public.offer_moments
  WHERE offer_id = v_offer_id;

  DELETE FROM public.offers
  WHERE workspace_id = v_advertiser_workspace_id;

  DELETE FROM private.integration_secrets
  WHERE integration_id = v_integration_id;

  DELETE FROM public.integrations
  WHERE product_id = v_product_id;

  DELETE FROM public.moments
  WHERE product_id = v_product_id;

  DELETE FROM public.products
  WHERE workspace_id = v_publisher_workspace_id;

  DELETE FROM public.workspace_capabilities
  WHERE workspace_id IN (v_publisher_workspace_id, v_advertiser_workspace_id);

  DELETE FROM public.workspace_members
  WHERE workspace_id IN (v_publisher_workspace_id, v_advertiser_workspace_id);

  DELETE FROM public.workspaces
  WHERE id IN (v_publisher_workspace_id, v_advertiser_workspace_id);

  SELECT count(*)
  INTO v_remaining_workspaces
  FROM public.workspaces
  WHERE name IN (v_prefix || '_publisher', v_prefix || '_advertiser');

  RETURN jsonb_build_object(
    'remaining_workspaces', v_remaining_workspaces
  );
END;
$$;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_verify(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_verify(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_verify(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_verify(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) TO service_role;

COMMIT;
