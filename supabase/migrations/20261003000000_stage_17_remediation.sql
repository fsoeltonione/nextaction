-- NextAction Stage 17: Remediation for ECON-005 and ECON-003
BEGIN;

-- ECON-005: Add UNIQUE constraint on qualified_click_id
CREATE UNIQUE INDEX IF NOT EXISTS settlements_qualified_click_id_uq
  ON private.settlements (qualified_click_id);

-- ECON-003: Atomic Qualify + Settle Transaction
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
AS $$
DECLARE
  v_qualify_result RECORD;
  v_settle_result RECORD;
BEGIN
  -- Execute qualification logic
  SELECT *
  INTO v_qualify_result
  FROM public.runtime_record_and_qualify_click(p_delivery_token_hash)
  LIMIT 1;

  -- If it wasn't qualified (e.g. replayed, not_found, pending, expired)
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

  -- Execute settlement logic
  SELECT *
  INTO v_settle_result
  FROM public.runtime_settle_qualified_click(v_qualify_result.result_qualified_click_id)
  LIMIT 1;

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
$$;

REVOKE ALL ON FUNCTION public.runtime_click_qualify_and_settle(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_click_qualify_and_settle(TEXT)
  TO service_role;


-- TEST-001: Re-introduce HTTP-accessible Smoke Fixtures
CREATE OR REPLACE FUNCTION public.production_smoke_fixture_create(
  p_smoke_id TEXT,
  p_user_id UUID,
  p_credential_hash TEXT
)
RETURNS TABLE (
  result_integration_id UUID,
  result_moment_key TEXT
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
BEGIN
  IF p_user_id IS NULL OR p_smoke_id IS NULL OR p_credential_hash IS NULL THEN
    RAISE EXCEPTION 'missing parameters' USING ERRCODE = '22023';
  END IF;

  v_moment_key := 'production_smoke_' || left(p_smoke_id, 24);

  INSERT INTO public.workspaces (name, user_id, created_by)
  VALUES ('__nextaction_prod_smoke_' || p_smoke_id || '_publisher', p_user_id, p_user_id)
  RETURNING id INTO v_publisher_workspace_id;

  INSERT INTO public.workspaces (name, user_id, created_by)
  VALUES ('__nextaction_prod_smoke_' || p_smoke_id || '_advertiser', p_user_id, p_user_id)
  RETURNING id INTO v_advertiser_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES
    (v_publisher_workspace_id, p_user_id, 'owner'),
    (v_advertiser_workspace_id, p_user_id, 'owner');

  INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
  VALUES
    (v_publisher_workspace_id, 'make_money', 'active'),
    (v_advertiser_workspace_id, 'reach_customers', 'active');

  INSERT INTO public.products (workspace_id, domain, name, description, canonical_url, understanding_status)
  VALUES (v_publisher_workspace_id, 'example.com', 'Production Smoke Publisher', 'Ephemeral production smoke fixture.', 'https://example.com', 'confirmed')
  RETURNING id INTO v_product_id;

  INSERT INTO public.moments (product_id, moment_key, label, description, status)
  VALUES (v_product_id, v_moment_key, 'Production Smoke Moment', 'Ephemeral production smoke fixture moment.', 'active')
  RETURNING id INTO v_moment_id;

  INSERT INTO public.integrations (product_id, name, status)
  VALUES (v_product_id, 'Production Smoke Integration', 'active')
  RETURNING id INTO v_integration_id;

  INSERT INTO private.integration_secrets (integration_id, credential_hash)
  VALUES (v_integration_id, p_credential_hash);

  INSERT INTO public.offers (workspace_id, title, description, cta_label, cta_url, target_moments, budget_cents, spent_cents, status, destination_url)
  VALUES (v_advertiser_workspace_id, 'Production Smoke Offer', 'Ephemeral production smoke fixture offer.', 'Open smoke destination', 'https://example.com/?nextaction_production_smoke=1', ARRAY[v_moment_key], 100, 0, 'active', 'https://example.com/?nextaction_production_smoke=1')
  RETURNING id INTO v_offer_id;

  INSERT INTO public.offer_moments (offer_id, moment_id)
  VALUES (v_offer_id, v_moment_id);

  INSERT INTO private.advertiser_credit_accounts (workspace_id, granted_units, consumed_units, available_units)
  VALUES (v_advertiser_workspace_id, 1, 0, 1);

  INSERT INTO private.advertiser_credit_entries (workspace_id, entry_type, units, reference_id)
  VALUES (v_advertiser_workspace_id, 'grant', 1, NULL);

  RETURN QUERY SELECT v_integration_id, v_moment_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.production_smoke_fixture_cleanup(
  p_smoke_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_smoke_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.workspaces
  WHERE name LIKE '__nextaction_prod_smoke_' || p_smoke_id || '%';
END;
$$;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_create(TEXT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_smoke_fixture_cleanup(TEXT) TO service_role;

COMMIT;
