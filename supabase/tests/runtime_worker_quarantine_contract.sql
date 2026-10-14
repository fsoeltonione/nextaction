BEGIN;
SELECT plan(19);

SELECT throws_ok(
  $$SELECT * FROM public.runtime_worker_tick(0, 60)$$,
  '22023',
  'invalid worker quantity',
  'worker rejects quantity below the lower bound'
);

SELECT throws_ok(
  $$SELECT * FROM public.runtime_worker_tick(101, 60)$$,
  '22023',
  'invalid worker quantity',
  'worker rejects quantity above the upper bound'
);

SELECT throws_ok(
  $$SELECT * FROM public.runtime_worker_tick(20, 4)$$,
  '22023',
  'invalid worker visibility',
  'worker rejects visibility below the lower bound'
);

SELECT throws_ok(
  $$SELECT * FROM public.runtime_worker_tick(20, 3601)$$,
  '22023',
  'invalid worker visibility',
  'worker rejects visibility above the upper bound'
);

SELECT throws_ok(
  $$SELECT public.runtime_operations_tick(59, 7200, 100)$$,
  '22023',
  'invalid stale event threshold',
  'operations RPC rejects an out-of-range stale event threshold'
);

SELECT throws_ok(
  $$SELECT public.runtime_operations_tick(300, 3599, 100)$$,
  '22023',
  'invalid rate limit retention',
  'operations RPC rejects too-short rate-limit retention'
);

SELECT throws_ok(
  $$SELECT public.runtime_operations_tick(300, 7200, 0)$$,
  '22023',
  'invalid recovery limit',
  'operations RPC rejects recovery limit below lower bound'
);

SELECT throws_ok(
  $$SELECT public.runtime_operations_tick(300, 7200, 501)$$,
  '22023',
  'invalid recovery limit',
  'operations RPC rejects recovery limit above upper bound'
);

SELECT throws_ok(
  $$SELECT private.reconcile_unsettled_qualified_clicks(NULL)$$,
  '22023',
  'invalid settlement recovery limit',
  'settlement recovery rejects NULL limit'
);

SELECT throws_ok(
  $$SELECT private.reconcile_unsettled_qualified_clicks(0)$$,
  '22023',
  'invalid settlement recovery limit',
  'settlement recovery rejects zero limit'
);

SELECT throws_ok(
  $$SELECT private.reconcile_unsettled_qualified_clicks(501)$$,
  '22023',
  'invalid settlement recovery limit',
  'settlement recovery rejects limit above 500'
);

CREATE TEMP TABLE p2_worker_quarantine_fixture (message_id BIGINT NOT NULL);
INSERT INTO p2_worker_quarantine_fixture (message_id)
SELECT pgmq.send(
  'runtime-events',
  pg_catalog.jsonb_build_object('event_id', '00000000-0000-4000-8000-000000000299')
);

SELECT is(
  (
    SELECT private.runtime_quarantine_message(
      f.message_id,
      1,
      timezone('utc'::text, now()),
      '{"p2":"worker-quarantine","iteration":1}'::JSONB,
      NULL,
      '00000000-0000-4000-8000-000000000298'::UUID,
      'malformed',
      'p2_contract_initial',
      'P2 disposable quarantine test'
    )
    FROM p2_worker_quarantine_fixture AS f
  ),
  TRUE,
  'quarantine records failure and archives a present queue message'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.runtime_dead_letters AS d
    JOIN p2_worker_quarantine_fixture AS f
      ON d.queue_message_id = f.message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  1,
  'first quarantine call creates one dead-letter row'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pgmq."q_runtime-events" AS q
    JOIN p2_worker_quarantine_fixture AS f ON f.message_id = q.msg_id
  ),
  'successfully quarantined message no longer remains in the active queue'
);

UPDATE private.runtime_dead_letters AS d
SET last_seen_at = '2000-01-01T00:00:00Z'::TIMESTAMPTZ
FROM p2_worker_quarantine_fixture AS f
WHERE d.queue_name = 'runtime-events'
  AND d.queue_message_id = f.message_id;

SELECT is(
  (
    SELECT private.runtime_quarantine_message(
      f.message_id,
      7,
      timezone('utc'::text, now()) - INTERVAL '1 minute',
      '{"p2":"worker-quarantine","iteration":2}'::JSONB,
      NULL,
      '00000000-0000-4000-8000-000000000297'::UUID,
      'retry_exhausted',
      'p2_contract_updated',
      'Updated P2 disposable quarantine metadata'
    )
    FROM p2_worker_quarantine_fixture AS f
  ),
  TRUE,
  'repeat quarantine remains successful when the queue message is already absent'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.runtime_dead_letters AS d
    JOIN p2_worker_quarantine_fixture AS f
      ON d.queue_message_id = f.message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  1,
  'repeat quarantine upserts the existing dead-letter row instead of duplicating it'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.runtime_dead_letters AS d
    JOIN p2_worker_quarantine_fixture AS f
      ON d.queue_message_id = f.message_id
    WHERE d.queue_name = 'runtime-events'
      AND d.read_count = 7
      AND d.failure_class = 'retry_exhausted'
      AND d.failure_code = 'p2_contract_updated'
      AND d.failure_reason = 'Updated P2 disposable quarantine metadata'
      AND d.request_id = '00000000-0000-4000-8000-000000000297'::UUID
      AND d.message = '{"p2":"worker-quarantine","iteration":2}'::JSONB
  ),
  'repeat quarantine refreshes failure metadata and request/event payload references'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.runtime_dead_letters AS d
    JOIN p2_worker_quarantine_fixture AS f
      ON d.queue_message_id = f.message_id
    WHERE d.queue_name = 'runtime-events'
      AND d.last_seen_at > '2000-01-01T00:00:00Z'::TIMESTAMPTZ
  ),
  'repeat quarantine updates last_seen_at'
);

SELECT * FROM finish();
ROLLBACK;
