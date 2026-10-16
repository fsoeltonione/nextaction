BEGIN;
SELECT plan(7);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'p2-composite-atomicity@contract.invalid',
  '',
  timezone('utc'::text, now()),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{}'::JSONB,
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE p2_atomicity_fixture AS
SELECT *
FROM public.production_smoke_fixture_create(
  repeat('d', 32),
  '00000000-0000-4000-8000-000000000401'::UUID,
  repeat('e', 64)
);

INSERT INTO private.decisions (
  id, moment_occurrence_id, integration_id, outcome, offer_id, reason_code, request_id
)
SELECT
  '00000000-0000-4000-8000-000000000402'::UUID,
  NULL,
  result_integration_id,
  'filled',
  result_offer_id,
  'p2_atomicity_contract',
  '00000000-0000-4000-8000-000000000406'::UUID
FROM pg_temp.p2_atomicity_fixture;

INSERT INTO private.deliveries (
  id, decision_id, offer_id, integration_id, delivery_nonce,
  delivery_token_hash, expires_at
)
SELECT
  '00000000-0000-4000-8000-000000000403'::UUID,
  '00000000-0000-4000-8000-000000000402'::UUID,
  result_offer_id,
  result_integration_id,
  'p2-atomicity-delivery-nonce',
  repeat('f', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
FROM pg_temp.p2_atomicity_fixture;

-- The wrong currency forces financial_unavailable after the composite RPC
-- begins the Click/qualification transition. Its exception must roll back all
-- earlier writes in that statement, while preserving capacity for retry.
INSERT INTO private.financial_accounts (owner_type, workspace_id, account_type, currency)
SELECT 'workspace', result_advertiser_workspace_id, 'advertiser_spend', 'EUR'
FROM pg_temp.p2_atomicity_fixture
ON CONFLICT (workspace_id, account_type) WHERE owner_type = 'workspace'
DO UPDATE SET currency = EXCLUDED.currency;

INSERT INTO private.financial_accounts (owner_type, workspace_id, account_type, currency)
SELECT 'workspace', result_publisher_workspace_id, 'publisher_earnings', 'USD'
FROM pg_temp.p2_atomicity_fixture
ON CONFLICT (workspace_id, account_type) WHERE owner_type = 'workspace'
DO UPDATE SET currency = EXCLUDED.currency;

INSERT INTO private.financial_accounts (owner_type, workspace_id, account_type, currency)
VALUES ('platform', NULL, 'platform_revenue', 'USD')
ON CONFLICT (account_type) WHERE owner_type = 'platform'
DO UPDATE SET currency = EXCLUDED.currency;

SELECT throws_ok(
  $$SELECT * FROM public.runtime_click_qualify_and_settle(repeat('f', 64))$$,
  'P0001',
  'atomic click settlement did not complete: financial_unavailable',
  'financial_unavailable in the composite RPC raises an error for transaction rollback'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM private.clicks WHERE click_token_hash = repeat('f', 64)),
  0,
  'failed composite settlement leaves no persisted Click'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.qualified_clicks AS qc
    JOIN private.clicks AS c ON c.id = qc.click_id
    WHERE c.click_token_hash = repeat('f', 64)
  ),
  0,
  'failed composite settlement leaves no Qualified Click'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements AS s
    JOIN private.qualified_clicks AS qc ON qc.id = s.qualified_click_id
    JOIN private.clicks AS c ON c.id = qc.click_id
    WHERE c.click_token_hash = repeat('f', 64)
  ),
  0,
  'failed composite settlement creates no Settlement'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.financial_entries AS fe
    JOIN private.settlements AS s ON s.id = fe.settlement_id
    JOIN private.qualified_clicks AS qc ON qc.id = s.qualified_click_id
    JOIN private.clicks AS c ON c.id = qc.click_id
    WHERE c.click_token_hash = repeat('f', 64)
  ),
  0,
  'failed composite settlement creates no financial ledger entries'
);

SELECT is(
  (
    SELECT a.available_units
    FROM private.advertiser_credit_accounts AS a
    JOIN pg_temp.p2_atomicity_fixture AS f
      ON f.result_advertiser_workspace_id = a.workspace_id
  ),
  1,
  'financial failure preserves the advertiser capacity unit for retry'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.advertiser_credit_entries AS ce
    JOIN pg_temp.p2_atomicity_fixture AS f
      ON f.result_advertiser_workspace_id = ce.workspace_id
    WHERE ce.entry_type = 'consumption'
  ),
  0,
  'financial failure does not write a credit consumption entry'
);

SELECT * FROM finish();
ROLLBACK;
