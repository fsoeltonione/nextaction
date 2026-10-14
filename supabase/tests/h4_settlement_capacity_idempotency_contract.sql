BEGIN;
SELECT plan(17);

-- Disposable-only synthetic user because the existing smoke fixture creates
-- workspace rows that reference auth.users. All effects roll back at the end.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000271',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'p2-settlement@contract.invalid',
  '',
  timezone('utc'::text, now()),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{}'::JSONB,
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE p2_settlement_flow AS
SELECT *
FROM public.production_smoke_fixture_create(
  repeat('e', 32),
  '00000000-0000-4000-8000-000000000271'::UUID,
  repeat('f', 64)
);

ALTER TABLE pg_temp.p2_settlement_flow
  ADD COLUMN decision_id UUID,
  ADD COLUMN delivery_id UUID,
  ADD COLUMN click_id UUID,
  ADD COLUMN qualified_click_id UUID,
  ADD COLUMN settlement_id UUID;

WITH inserted AS (
  INSERT INTO private.decisions (
    moment_occurrence_id,
    integration_id,
    outcome,
    offer_id,
    reason_code,
    request_id
  )
  SELECT
    NULL,
    result_integration_id,
    'filled',
    result_offer_id,
    'p2_settlement_contract',
    '00000000-0000-4000-8000-000000000272'::UUID
  FROM pg_temp.p2_settlement_flow
  RETURNING id
)
UPDATE pg_temp.p2_settlement_flow AS f
SET decision_id = inserted.id
FROM inserted;

WITH inserted AS (
  INSERT INTO private.deliveries (
    decision_id,
    offer_id,
    integration_id,
    delivery_nonce,
    delivery_token_hash,
    expires_at
  )
  SELECT
    decision_id,
    result_offer_id,
    result_integration_id,
    'p2-settlement-delivery-nonce',
    'p2-settlement-delivery-token-hash',
    timezone('utc'::text, now()) + INTERVAL '1 hour'
  FROM pg_temp.p2_settlement_flow
  RETURNING id
)
UPDATE pg_temp.p2_settlement_flow AS f
SET delivery_id = inserted.id
FROM inserted;

WITH inserted AS (
  INSERT INTO private.clicks (
    delivery_id,
    click_token_hash,
    qualification_status,
    verification_result
  )
  SELECT
    delivery_id,
    'p2-settlement-click-token-hash',
    'qualified',
    'contract_fixture'
  FROM pg_temp.p2_settlement_flow
  RETURNING id
)
UPDATE pg_temp.p2_settlement_flow AS f
SET click_id = inserted.id
FROM inserted;

WITH inserted AS (
  INSERT INTO private.qualified_clicks (
    click_id,
    qualification_version,
    reason_code
  )
  SELECT
    click_id,
    'p2_settlement_contract_v1',
    'p2_contract_qualified'
  FROM pg_temp.p2_settlement_flow
  RETURNING id
)
UPDATE pg_temp.p2_settlement_flow AS f
SET qualified_click_id = inserted.id
FROM inserted;

UPDATE private.advertiser_credit_accounts AS a
SET granted_units = 0, consumed_units = 0, available_units = 0
FROM pg_temp.p2_settlement_flow AS f
WHERE a.workspace_id = f.result_advertiser_workspace_id;

CREATE TEMP TABLE p2_no_capacity_attempt AS
SELECT r.*
FROM public.runtime_settle_qualified_click(
  (SELECT qualified_click_id FROM pg_temp.p2_settlement_flow)
) AS r;

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_no_capacity_attempt),
  'no_capacity',
  'zero advertiser capacity produces the explicit retryable no_capacity outcome'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements AS s
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.qualified_click_id = s.qualified_click_id
  ),
  0,
  'no_capacity does not create a settlement'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.financial_entries AS fe
    JOIN private.settlements AS s ON s.id = fe.settlement_id
    JOIN pg_temp.p2_settlement_flow AS f ON f.qualified_click_id = s.qualified_click_id
  ),
  0,
  'no_capacity does not create financial ledger entries'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.advertiser_credit_entries AS ce
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.result_advertiser_workspace_id = ce.workspace_id
    WHERE ce.entry_type = 'consumption'
  ),
  0,
  'no_capacity does not consume an advertiser credit unit'
);

UPDATE private.advertiser_credit_accounts AS a
SET granted_units = 1, consumed_units = 0, available_units = 1
FROM pg_temp.p2_settlement_flow AS f
WHERE a.workspace_id = f.result_advertiser_workspace_id;

CREATE TEMP TABLE p2_settled_attempt AS
SELECT r.*
FROM public.runtime_settle_qualified_click(
  (SELECT qualified_click_id FROM pg_temp.p2_settlement_flow)
) AS r;

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_settled_attempt),
  'settled',
  'one available unit allows the Qualified Click to settle'
);

UPDATE pg_temp.p2_settlement_flow AS f
SET settlement_id = s.result_settlement_id
FROM pg_temp.p2_settled_attempt AS s;

SELECT ok(
  (SELECT settlement_id IS NOT NULL FROM pg_temp.p2_settlement_flow),
  'successful settlement returns a stable Settlement ID'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.settlements AS s
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.qualified_click_id = s.qualified_click_id
    WHERE s.id = f.settlement_id
      AND s.charge_cents = 100
      AND s.publisher_share_cents = 75
      AND s.platform_share_cents = 25
      AND s.currency = 'USD'
  ),
  'settlement persists the fixed $1 charge, 75/25 split, and USD contract'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements AS s
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.qualified_click_id = s.qualified_click_id
  ),
  1,
  'exactly one Settlement exists for the Qualified Click'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.financial_entries AS fe
    JOIN pg_temp.p2_settlement_flow AS f ON f.settlement_id = fe.settlement_id
  ),
  3,
  'settlement writes exactly three financial ledger entries'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.financial_entries AS fe
    JOIN pg_temp.p2_settlement_flow AS f ON f.settlement_id = fe.settlement_id
    GROUP BY fe.settlement_id
    HAVING sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'debit') = 100
       AND sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'credit') = 100
  ),
  'debit and credit ledger totals balance to 100 cents'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.advertiser_credit_entries AS ce
    JOIN pg_temp.p2_settlement_flow AS f ON f.settlement_id = ce.reference_id
    WHERE ce.entry_type = 'consumption'
  ),
  1,
  'successful settlement consumes one credit entry keyed by Settlement ID'
);

SELECT is(
  (
    SELECT available_units
    FROM private.advertiser_credit_accounts AS a
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.result_advertiser_workspace_id = a.workspace_id
  ),
  0,
  'successful settlement decrements available capacity from one to zero'
);

CREATE TEMP TABLE p2_replayed_attempt AS
SELECT r.*
FROM public.runtime_settle_qualified_click(
  (SELECT qualified_click_id FROM pg_temp.p2_settlement_flow)
) AS r;

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_replayed_attempt),
  'replayed',
  'settlement retry after success returns replayed instead of creating another charge'
);

SELECT is(
  (SELECT result_settlement_id FROM pg_temp.p2_replayed_attempt),
  (SELECT settlement_id FROM pg_temp.p2_settlement_flow),
  'settlement retry returns the original Settlement ID'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements AS s
    JOIN pg_temp.p2_settlement_flow AS f
      ON f.qualified_click_id = s.qualified_click_id
  ),
  1,
  'replay does not create a duplicate Settlement'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.financial_entries AS fe
    JOIN pg_temp.p2_settlement_flow AS f ON f.settlement_id = fe.settlement_id
  ),
  3,
  'replay does not duplicate financial ledger entries'
);

SELECT * FROM finish();
ROLLBACK;
