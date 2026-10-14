BEGIN;
SELECT plan(10);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000281',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'p2-network-runtime@contract.invalid',
  '',
  timezone('utc'::text, now()),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{}'::JSONB,
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE p2_network_fixture AS
SELECT *
FROM public.production_smoke_fixture_create(
  repeat('d', 32),
  '00000000-0000-4000-8000-000000000281'::UUID,
  repeat('a', 64)
);

INSERT INTO public.network_moments (key, label, description, status)
VALUES (
  'p2_network_runtime',
  'P2 Network Runtime Contract',
  'Disposable-only H3.1 runtime test fixture',
  'active'
);

UPDATE public.moments AS m
SET network_moment_id = nm.id
FROM pg_temp.p2_network_fixture AS f
CROSS JOIN public.network_moments AS nm
WHERE m.id = f.result_moment_id
  AND nm.key = 'p2_network_runtime';

INSERT INTO public.offer_network_moments (offer_id, network_moment_id)
SELECT f.result_offer_id, nm.id
FROM pg_temp.p2_network_fixture AS f
CROSS JOIN public.network_moments AS nm
WHERE nm.key = 'p2_network_runtime';

INSERT INTO private.events (
  integration_id,
  idempotency_key,
  event_type,
  occurred_at,
  payload,
  processing_status,
  request_id
)
SELECT
  f.result_integration_id,
  'p2_network_runtime_event',
  f.result_moment_key,
  timezone('utc'::text, now()),
  '{"contract":"p2_network_runtime"}'::JSONB,
  'processed',
  '00000000-0000-4000-8000-000000000282'::UUID
FROM pg_temp.p2_network_fixture AS f;

INSERT INTO private.moment_occurrences (
  moment_id,
  event_id,
  integration_id,
  occurred_at,
  metadata
)
SELECT
  f.result_moment_id,
  e.id,
  f.result_integration_id,
  timezone('utc'::text, now()),
  '{"contract":"p2_network_runtime"}'::JSONB
FROM pg_temp.p2_network_fixture AS f
JOIN private.events AS e
  ON e.integration_id = f.result_integration_id
 AND e.idempotency_key = 'p2_network_runtime_event';

CREATE TEMP TABLE p2_network_first_delivery AS
SELECT *
FROM public.runtime_create_decision_delivery(
  (SELECT result_integration_id FROM pg_temp.p2_network_fixture),
  (SELECT result_moment_key FROM pg_temp.p2_network_fixture),
  '00000000-0000-4000-8000-000000000283'::UUID,
  'p2-network-delivery-nonce-001',
  repeat('1', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
);

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_network_first_delivery),
  'filled',
  'active Network Moment targeting produces a filled Decision and Delivery'
);

SELECT is(
  (SELECT result_offer_id FROM pg_temp.p2_network_first_delivery),
  (SELECT result_offer_id FROM pg_temp.p2_network_fixture),
  'active Network Moment path selects the Offer linked through offer_network_moments'
);

SELECT ok(
  (SELECT result_delivery_id IS NOT NULL FROM pg_temp.p2_network_first_delivery),
  'active Network Moment path returns a Delivery ID'
);

SELECT is(
  (SELECT result_destination_url FROM pg_temp.p2_network_first_delivery),
  'https://example.com/?nextaction_production_smoke=1',
  'Network Moment delivery returns the configured destination URL'
);

DELETE FROM public.offer_network_moments AS onm
USING pg_temp.p2_network_fixture AS f
WHERE onm.offer_id = f.result_offer_id;

CREATE TEMP TABLE p2_network_legacy_fallback AS
SELECT *
FROM public.runtime_create_decision_delivery(
  (SELECT result_integration_id FROM pg_temp.p2_network_fixture),
  (SELECT result_moment_key FROM pg_temp.p2_network_fixture),
  '00000000-0000-4000-8000-000000000284'::UUID,
  'p2-network-delivery-nonce-002',
  repeat('2', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
);

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_network_legacy_fallback),
  'filled',
  'runtime falls back to product-scoped offer_moments when no network-targeted Offer is eligible'
);

SELECT is(
  (SELECT result_offer_id FROM pg_temp.p2_network_legacy_fallback),
  (SELECT result_offer_id FROM pg_temp.p2_network_fixture),
  'legacy fallback returns the eligible product-scoped Offer'
);

DELETE FROM public.offer_moments AS om
USING pg_temp.p2_network_fixture AS f
WHERE om.offer_id = f.result_offer_id
  AND om.moment_id = f.result_moment_id;

CREATE TEMP TABLE p2_network_no_eligible_offer AS
SELECT *
FROM public.runtime_create_decision_delivery(
  (SELECT result_integration_id FROM pg_temp.p2_network_fixture),
  (SELECT result_moment_key FROM pg_temp.p2_network_fixture),
  '00000000-0000-4000-8000-000000000285'::UUID,
  'p2-network-delivery-nonce-003',
  repeat('3', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
);

SELECT is(
  (SELECT result_outcome FROM pg_temp.p2_network_no_eligible_offer),
  'no_fill',
  'runtime emits no_fill when neither network nor legacy targeting has an eligible Offer'
);

SELECT is(
  (SELECT result_reason_code FROM pg_temp.p2_network_no_eligible_offer),
  'no_eligible_offer',
  'no eligible Network/legacy Offer reports the stable no_eligible_offer reason'
);

SELECT ok(
  (SELECT result_delivery_id IS NULL FROM pg_temp.p2_network_no_eligible_offer),
  'no_fill does not return a Delivery ID'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.deliveries AS d
    JOIN pg_temp.p2_network_fixture AS f
      ON d.integration_id = f.result_integration_id
    WHERE d.delivery_nonce IN (
      'p2-network-delivery-nonce-001',
      'p2-network-delivery-nonce-002',
      'p2-network-delivery-nonce-003'
    )
  ),
  2,
  'only successful Network/legacy fills persist deliveries; no_fill persists none'
);

SELECT * FROM finish();
ROLLBACK;
