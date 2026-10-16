CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_workspace_account_type_uq
  ON private.financial_accounts (workspace_id, account_type)
  WHERE owner_type = 'workspace';

CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_platform_account_type_uq
  ON private.financial_accounts (account_type)
  WHERE owner_type = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_settlement_account_uq
  ON private.financial_entries (settlement_id, account_id);

CREATE OR REPLACE FUNCTION public.runtime_settle_qualified_click(
  p_qualified_click_id UUID
)
RETURNS TABLE (
  result_outcome TEXT,
  result_settlement_id UUID,
  result_qualified_click_id UUID,
  result_advertiser_workspace_id UUID,
  result_publisher_workspace_id UUID,
  result_charge_cents INTEGER,
  result_publisher_share_cents INTEGER,
  result_platform_share_cents INTEGER,
  result_currency TEXT,
  result_remaining_capacity INTEGER,
  result_reason_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qualified_click_id UUID;
  v_click_status TEXT;
  v_advertiser_workspace_id UUID;
  v_publisher_workspace_id UUID;
  v_existing_settlement_id UUID;
  v_settlement_id UUID;
  v_advertiser_account_id UUID;
  v_publisher_account_id UUID;
  v_platform_account_id UUID;
  v_capacity_available INTEGER;
  v_remaining_capacity INTEGER;
  v_advertiser_currency TEXT;
  v_publisher_currency TEXT;
  v_platform_currency TEXT;
BEGIN
  IF p_qualified_click_id IS NULL THEN
    RAISE EXCEPTION 'qualified click id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    qc.id,
    c.qualification_status,
    o.workspace_id,
    p.workspace_id
  INTO
    v_qualified_click_id,
    v_click_status,
    v_advertiser_workspace_id,
    v_publisher_workspace_id
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
  WHERE qc.id = p_qualified_click_id
  FOR UPDATE OF qc;

  IF v_qualified_click_id IS NULL THEN
    RETURN QUERY
    SELECT
      'not_found'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::TEXT,
      NULL::INTEGER,
      'qualified_click_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_click_status <> 'qualified' THEN
    RETURN QUERY
    SELECT
      'not_qualified'::TEXT,
      NULL::UUID,
      v_qualified_click_id,
      v_advertiser_workspace_id,
      v_publisher_workspace_id,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::TEXT,
      NULL::INTEGER,
      'click_not_qualified'::TEXT;
    RETURN;
  END IF;

  SELECT s.id
  INTO v_existing_settlement_id
  FROM private.settlements AS s
  WHERE s.qualified_click_id = v_qualified_click_id
  LIMIT 1;

  IF v_existing_settlement_id IS NOT NULL THEN
    SELECT a.available_units
    INTO v_remaining_capacity
    FROM private.advertiser_credit_accounts AS a
    WHERE a.workspace_id = v_advertiser_workspace_id;

    RETURN QUERY
    SELECT
      'replayed'::TEXT,
      s.id,
      s.qualified_click_id,
      s.advertiser_workspace_id,
      s.publisher_workspace_id,
      s.charge_cents,
      s.publisher_share_cents,
      s.platform_share_cents,
      s.currency,
      v_remaining_capacity,
      'settlement_already_exists'::TEXT
    FROM private.settlements AS s
    WHERE s.id = v_existing_settlement_id;
    RETURN;
  END IF;

  SELECT a.available_units
  INTO v_capacity_available
  FROM private.advertiser_credit_accounts AS a
  WHERE a.workspace_id = v_advertiser_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR v_capacity_available <= 0 THEN
    RETURN QUERY
    SELECT
      'no_capacity'::TEXT,
      NULL::UUID,
      v_qualified_click_id,
      v_advertiser_workspace_id,
      v_publisher_workspace_id,
      100,
      75,
      25,
      'USD'::TEXT,
      COALESCE(v_capacity_available, 0),
      'advertiser_capacity_unavailable'::TEXT;
    RETURN;
  END IF;

  INSERT INTO private.financial_accounts (
    owner_type,
    workspace_id,
    account_type,
    currency
  )
  VALUES (
    'workspace',
    v_advertiser_workspace_id,
    'advertiser_spend',
    'USD'
  )
  ON CONFLICT (workspace_id, account_type)
  WHERE owner_type = 'workspace'
  DO NOTHING;

  INSERT INTO private.financial_accounts (
    owner_type,
    workspace_id,
    account_type,
    currency
  )
  VALUES (
    'workspace',
    v_publisher_workspace_id,
    'publisher_earnings',
    'USD'
  )
  ON CONFLICT (workspace_id, account_type)
  WHERE owner_type = 'workspace'
  DO NOTHING;

  INSERT INTO private.financial_accounts (
    owner_type,
    workspace_id,
    account_type,
    currency
  )
  VALUES (
    'platform',
    NULL,
    'platform_revenue',
    'USD'
  )
  ON CONFLICT (account_type)
  WHERE owner_type = 'platform'
  DO NOTHING;

  SELECT id, currency
  INTO v_advertiser_account_id, v_advertiser_currency
  FROM private.financial_accounts
  WHERE owner_type = 'workspace'
    AND workspace_id = v_advertiser_workspace_id
    AND account_type = 'advertiser_spend'
  LIMIT 1;

  SELECT id, currency
  INTO v_publisher_account_id, v_publisher_currency
  FROM private.financial_accounts
  WHERE owner_type = 'workspace'
    AND workspace_id = v_publisher_workspace_id
    AND account_type = 'publisher_earnings'
  LIMIT 1;

  SELECT id, currency
  INTO v_platform_account_id, v_platform_currency
  FROM private.financial_accounts
  WHERE owner_type = 'platform'
    AND account_type = 'platform_revenue'
  LIMIT 1;

  IF v_advertiser_account_id IS NULL
     OR v_publisher_account_id IS NULL
     OR v_platform_account_id IS NULL
     OR v_advertiser_currency <> 'USD'
     OR v_publisher_currency <> 'USD'
     OR v_platform_currency <> 'USD'
  THEN
    RETURN QUERY
    SELECT
      'financial_unavailable'::TEXT,
      NULL::UUID,
      v_qualified_click_id,
      v_advertiser_workspace_id,
      v_publisher_workspace_id,
      100,
      75,
      25,
      'USD'::TEXT,
      v_capacity_available,
      'financial_accounts_unavailable'::TEXT;
    RETURN;
  END IF;

  INSERT INTO private.settlements (
    qualified_click_id,
    advertiser_workspace_id,
    publisher_workspace_id,
    charge_cents,
    publisher_share_cents,
    platform_share_cents,
    currency
  )
  VALUES (
    v_qualified_click_id,
    v_advertiser_workspace_id,
    v_publisher_workspace_id,
    100,
    75,
    25,
    'USD'
  )
  RETURNING id INTO v_settlement_id;

  INSERT INTO private.financial_entries (
    settlement_id,
    account_id,
    entry_type,
    amount_cents
  )
  VALUES
    (
      v_settlement_id,
      v_advertiser_account_id,
      'debit',
      100
    ),
    (
      v_settlement_id,
      v_publisher_account_id,
      'credit',
      75
    ),
    (
      v_settlement_id,
      v_platform_account_id,
      'credit',
      25
    );

  INSERT INTO private.advertiser_credit_entries (
    workspace_id,
    entry_type,
    units,
    reference_id
  )
  VALUES (
    v_advertiser_workspace_id,
    'consumption',
    1,
    v_settlement_id
  );

  UPDATE private.advertiser_credit_accounts
  SET
    consumed_units = consumed_units + 1,
    available_units = available_units - 1,
    updated_at = timezone('utc'::text, now())
  WHERE workspace_id = v_advertiser_workspace_id
    AND available_units > 0
  RETURNING available_units INTO v_remaining_capacity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'advertiser capacity changed during settlement'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  SELECT
    'settled'::TEXT,
    v_settlement_id,
    v_qualified_click_id,
    v_advertiser_workspace_id,
    v_publisher_workspace_id,
    100,
    75,
    25,
    'USD'::TEXT,
    v_remaining_capacity,
    'settlement_created'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_settle_qualified_click(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.runtime_settle_qualified_click(UUID)
  TO service_role;
