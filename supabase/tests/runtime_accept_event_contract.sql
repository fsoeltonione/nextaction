BEGIN;

SELECT plan(12);

-- Disposable contract fixture only. All writes are contained in this test
-- transaction and rolled back below; this test never targets hosted databases.
INSERT INTO public.workspaces (id, name, user_id, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'runtime_accept_event_contract',
  NULL,
  '00000000-0000-4000-8000-000000000105'
);

INSERT INTO public.products (
  id, workspace_id, domain, name, canonical_url, understanding_status
)
VALUES (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  'contract-test.invalid',
  'Runtime Accept Event Contract',
  'https://contract-test.invalid',
  'confirmed'
);

INSERT INTO public.integrations (id, product_id, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000102',
  'Runtime Accept Event Contract',
  'active'
);

INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'make_money',
  'active'
);

SELECT is(
  (
    SELECT result_created
    FROM public.runtime_accept_event(
      '00000000-0000-4000-8000-000000000103',
      'contract_accept_event_01',
      'contract_test',
      '2026-10-14T00:00:00Z',
      '{"contract":"runtime_accept_event","version":1}'::jsonb,
      NULL
    )
  ),
  TRUE,
  'valid first delivery creates exactly one Event'
);

SELECT is(
  (
    SELECT result_created
    FROM public.runtime_accept_event(
      '00000000-0000-4000-8000-000000000103',
      'contract_accept_event_01',
      'contract_test',
      '2026-10-14T00:00:00Z',
      '{"contract":"runtime_accept_event","version":1}'::jsonb,
      NULL
    )
  ),
  FALSE,
  'exact replay is idempotent and does not create another Event'
);

SELECT is(
  (
    SELECT result_event_id
    FROM public.runtime_accept_event(
      '00000000-0000-4000-8000-000000000103',
      'contract_accept_event_01',
      'contract_test',
      '2026-10-14T00:00:00Z',
      '{"contract":"runtime_accept_event","version":1}'::jsonb,
      NULL
    )
  ),
  (
    SELECT id
    FROM private.events
    WHERE integration_id = '00000000-0000-4000-8000-000000000103'
      AND idempotency_key = 'contract_accept_event_01'
  ),
  'exact replay returns the original Event ID'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.events
    WHERE integration_id = '00000000-0000-4000-8000-000000000103'
      AND idempotency_key = 'contract_accept_event_01'
  ),
  1,
  'exact replay persists only one Event row'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pgmq."q_runtime-events" AS q
    JOIN private.events AS e
      ON q.message->>'event_id' = e.id::text
    WHERE e.integration_id = '00000000-0000-4000-8000-000000000103'
      AND e.idempotency_key = 'contract_accept_event_01'
  ),
  1,
  'exact replay enqueues only one runtime message'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'contract_accept_event_01',
    'contract_test',
    '2026-10-14T00:00:00Z',
    '{"contract":"runtime_accept_event","version":2}'::jsonb,
    NULL
  )$p2$,
  '23505',
  'idempotency key was already used with different event data',
  'same idempotency key with changed payload is rejected'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'contract_accept_event_01',
    'changed_event_type',
    '2026-10-14T00:00:00Z',
    '{"contract":"runtime_accept_event","version":1}'::jsonb,
    NULL
  )$p2$,
  '23505',
  'idempotency key was already used with different event data',
  'same idempotency key with changed event type is rejected'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'contract_accept_event_01',
    'contract_test',
    '2026-10-15T00:00:00Z',
    '{"contract":"runtime_accept_event","version":1}'::jsonb,
    NULL
  )$p2$,
  '23505',
  'idempotency key was already used with different event data',
  'same idempotency key with changed occurred_at is rejected'
);

SELECT throws_ok(
  $$p2$SELECT * FROM public.runtime_accept_event(
    NULL,
    'contract_accept_event_02',
    'contract_test',
    '2026-10-14T00:00:00Z',
    '{}'::jsonb,
    NULL
  )$$p2$,
  '22023',
  'integration is required',
  'missing integration ID is rejected'
);

SELECT throws_ok(
  $$p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'invalid key with spaces',
    'contract_test',
    '2026-10-14T00:00:00Z',
    '{}'::jsonb,
    NULL
  )$$p2$,
  '22023',
  'invalid idempotency key',
  'malformed idempotency key is rejected before Event insertion'
);

SELECT throws_ok(
  $$p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'contract_accept_event_03',
    'invalid event type',
    '2026-10-14T00:00:00Z',
    '{}'::jsonb,
    NULL
  )$$p2$,
  '22023',
  'invalid event type',
  'malformed event type is rejected before Event insertion'
);

SELECT throws_ok(
  $$p2$SELECT * FROM public.runtime_accept_event(
    '00000000-0000-4000-8000-000000000103',
    'contract_accept_event_04',
    'contract_test',
    '2026-10-14T00:00:00Z',
    '[]'::jsonb,
    NULL
  )$$p2$,
  '22023',
  'event data must be an object',
  'non-object JSON payload is rejected'
);

SELECT * FROM finish();
ROLLBACK;
