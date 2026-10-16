BEGIN;
SELECT plan(10);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000291',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'p2-recovery@contract.invalid',
  '',
  timezone('utc'::text, now()),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{}'::JSONB,
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, name, user_id, created_by)
VALUES
  (
    '00000000-0000-4000-8000-000000000292',
    'p2_recovery_publisher',
    '00000000-0000-4000-8000-000000000291',
    '00000000-0000-4000-8000-000000000291'
  ),
  (
    '00000000-0000-4000-8000-000000000293',
    'p2_recovery_advertiser',
    '00000000-0000-4000-8000-000000000291',
    '00000000-0000-4000-8000-000000000291'
  );

INSERT INTO public.products (
  id, workspace_id, domain, name, canonical_url, understanding_status
)
VALUES (
  '00000000-0000-4000-8000-000000000294',
  '00000000-0000-4000-8000-000000000292',
  'p2-recovery-publisher.invalid',
  'P2 Recovery Publisher Product',
  'https://p2-recovery-publisher.invalid',
  'confirmed'
);

INSERT INTO public.integrations (id, product_id, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000295',
  '00000000-0000-4000-8000-000000000294',
  'P2 Recovery Integration',
  'active'
);

INSERT INTO public.offers (
  id,
  workspace_id,
  title,
  description,
  cta_label,
  cta_url,
  destination_url,
  target_moments,
  budget_cents,
  spent_cents,
  status
)
VALUES (
  '00000000-0000-4000-8000-000000000296',
  '00000000-0000-4000-8000-000000000293',
  'P2 Recovery Offer',
  'Disposable settlement recovery fixture',
  'Open recovery offer',
  'https://p2-recovery-advertiser.invalid',
  'https://p2-recovery-advertiser.invalid',
  ARRAY[]::TEXT[],
  0,
  0,
  'active'
);

INSERT INTO private.advertiser_credit_accounts (
  workspace_id, granted_units, consumed_units, available_units
)
VALUES (
  '00000000-0000-4000-8000-000000000293',
  1,
  0,
  1
);

INSERT INTO private.decisions (
  id, moment_occurrence_id, integration_id, outcome, offer_id, reason_code, request_id
)
VALUES (
  '00000000-0000-4000-8000-000000000297',
  NULL,
  '00000000-0000-4000-8000-000000000295',
  'filled',
  '00000000-0000-4000-8000-000000000296',
  'p2_recovery_fixture',
  '00000000-0000-4000-8000-000000000298'
);

INSERT INTO private.deliveries (
  id, decision_id, offer_id, integration_id, delivery_nonce, delivery_token_hash, expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000299',
  '00000000-0000-4000-8000-000000000297',
  '00000000-0000-4000-8000-000000000296',
  '00000000-0000-4000-8000-000000000295',
  'p2-recovery-delivery-nonce',
  repeat('b', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
);

INSERT INTO private.clicks (
  id, delivery_id, click_token_hash, clicked_at, qualification_status, verification_result
)
VALUES (
  '00000000-0000-4000-8000-000000000300',
  '00000000-0000-4000-8000-000000000299',
  'p2-recovery-click-hash',
  timezone('utc'::text, now()) - INTERVAL '10 minutes',
  'qualified',
  'p2_recovery_fixture'
);

INSERT INTO private.qualified_clicks (
  id, click_id, qualification_version, reason_code, qualified_at
)
VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000300',
  'p2_recovery_contract_v1',
  'p2_stale_qualified_click',
  timezone('utc'::text, now()) - INTERVAL '10 minutes'
);

CREATE TEMP TABLE p2_recovery_first_attempt AS
SELECT private.reconcile_unsettled_qualified_clicks(10) AS result;

SELECT is(
  (SELECT result->>'attempted' FROM pg_temp.p2_recovery_first_attempt),
  '1',
  'recovery selects exactly one stale qualified click with no settlement'
);

SELECT is(
  (SELECT result->>'settled' FROM pg_temp.p2_recovery_first_attempt),
  '1',
  'recovery creates a settlement for an eligible stale qualified click'
);

SELECT is(
  (SELECT result->>'no_capacity' FROM pg_temp.p2_recovery_first_attempt),
  '0',
  'eligible advertiser capacity is not classified as no_capacity'
);

SELECT is(
  (SELECT result->>'failed' FROM pg_temp.p2_recovery_first_attempt),
  '0',
  'successful recovery does not increment failed count'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements
    WHERE qualified_click_id = '00000000-0000-4000-8000-000000000301'::UUID
  ),
  1,
  'recovery creates exactly one Settlement for the recovered Qualified Click'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.financial_entries AS fe
    JOIN private.settlements AS s ON s.id = fe.settlement_id
    WHERE s.qualified_click_id = '00000000-0000-4000-8000-000000000301'::UUID
  ),
  3,
  'recovery writes the three balanced financial ledger entries'
);

SELECT is(
  (
    SELECT available_units
    FROM private.advertiser_credit_accounts
    WHERE workspace_id = '00000000-0000-4000-8000-000000000293'::UUID
  ),
  0,
  'recovery consumes exactly one available advertiser unit'
);

CREATE TEMP TABLE p2_recovery_second_attempt AS
SELECT private.reconcile_unsettled_qualified_clicks(10) AS result;

SELECT is(
  (SELECT result->>'attempted' FROM pg_temp.p2_recovery_second_attempt),
  '0',
  'a repeated recovery does not select an already-settled Qualified Click'
);

SELECT is(
  (
    SELECT result_outcome
    FROM public.runtime_settle_qualified_click('00000000-0000-4000-8000-000000000301'::UUID)
  ),
  'replayed',
  'direct settlement retry after recovery returns the original Settlement as replayed'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.settlements
    WHERE qualified_click_id = '00000000-0000-4000-8000-000000000301'::UUID
  ),
  1,
  'recovery and subsequent retry do not duplicate the Settlement'
);

SELECT * FROM finish();
ROLLBACK;
