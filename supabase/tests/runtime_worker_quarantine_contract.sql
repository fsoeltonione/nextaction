BEGIN;
SELECT plan(33);

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


CREATE TEMP TABLE p2_bad_queue_messages (
  message_kind TEXT NOT NULL,
  message_id BIGINT NOT NULL
);

INSERT INTO pg_temp.p2_bad_queue_messages (message_kind, message_id)
SELECT
  'non_object',
  sent.message_id
FROM pgmq.send('runtime-events', '[]'::JSONB) AS sent(message_id)
UNION ALL
SELECT
  'invalid_event_id',
  sent.message_id
FROM pgmq.send(
  'runtime-events',
  pg_catalog.jsonb_build_object('event_id', 'not-a-uuid')
) AS sent(message_id);

SELECT is(
  (
    SELECT result_failed
    FROM public.runtime_worker_tick(20, 5)
  ),
  2,
  'actual worker RPC reports both malformed queue messages as failures'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_bad_queue_messages AS b
      ON b.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events'
      AND d.failure_class = 'malformed'
      AND (
        (b.message_kind = 'non_object' AND d.failure_code = 'invalid_queue_message')
        OR (b.message_kind = 'invalid_event_id' AND d.failure_code = 'invalid_event_id')
      )
  ),
  2,
  'actual worker records distinct malformed-payload failure codes'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM pgmq."q_runtime-events" AS q
    JOIN pg_temp.p2_bad_queue_messages AS b
      ON b.message_id = q.msg_id
  ),
  0,
  'actual worker quarantines and archives both malformed queue messages'
);


-- Exercise the real retry budget through runtime_worker_tick. A transactional
-- trigger injects a retryable serialization failure only for the synthetic
-- Event; it and its effects disappear with this file's final ROLLBACK.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000304',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'p2-worker-retry@contract.invalid',
  '',
  timezone('utc'::text, now()),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{}'::JSONB,
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE p2_retry_fixture AS
SELECT *
FROM public.production_smoke_fixture_create(
  repeat('c', 32),
  '00000000-0000-4000-8000-000000000304'::UUID,
  repeat('c', 64)
);

INSERT INTO private.events (
  id,
  integration_id,
  idempotency_key,
  event_type,
  occurred_at,
  payload,
  request_id
)
SELECT
  '00000000-0000-4000-8000-000000000305'::UUID,
  result_integration_id,
  'p2_worker_retry_event',
  result_moment_key,
  timezone('utc'::text, now()),
  '{"contract":"p2_worker_retry","inject":"40001"}'::JSONB,
  '00000000-0000-4000-8000-000000000306'::UUID
FROM pg_temp.p2_retry_fixture;

CREATE OR REPLACE FUNCTION private.p2_inject_worker_retry_failure()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $p2_inject$
BEGIN
  IF NEW.event_id = '00000000-0000-4000-8000-000000000305'::UUID THEN
    RAISE EXCEPTION 'P2 injected retryable serialization failure'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$p2_inject$;

CREATE TRIGGER p2_inject_worker_retry_failure
BEFORE INSERT ON private.moment_occurrences
FOR EACH ROW
EXECUTE FUNCTION private.p2_inject_worker_retry_failure();

CREATE TEMP TABLE p2_retry_queue AS
SELECT pgmq.send(
  'runtime-events',
  pg_catalog.jsonb_build_object('event_id', '00000000-0000-4000-8000-000000000305')
) AS message_id;

CREATE TEMP TABLE p2_retry_observation (
  iteration INTEGER NOT NULL,
  result_failed INTEGER NOT NULL,
  processing_attempts INTEGER NOT NULL,
  last_failure_class TEXT,
  dead_letter_count INTEGER NOT NULL,
  active_queue_count INTEGER NOT NULL
);

DO $p2_retry_loop$
DECLARE
  v_iteration INTEGER;
  v_failed INTEGER;
  v_attempts INTEGER;
  v_failure_class TEXT;
  v_dead_letters INTEGER;
  v_queued INTEGER;
BEGIN
  FOR v_iteration IN 1..5 LOOP
    UPDATE pgmq."q_runtime-events"
    SET vt = clock_timestamp() - INTERVAL '1 second'
    WHERE msg_id = (SELECT message_id FROM pg_temp.p2_retry_queue);

    SELECT w.result_failed
    INTO v_failed
    FROM public.runtime_worker_tick(1, 5) AS w;

    SELECT e.processing_attempts, e.last_failure_class
    INTO v_attempts, v_failure_class
    FROM private.events AS e
    WHERE e.id = '00000000-0000-4000-8000-000000000305'::UUID;

    SELECT count(*)::INTEGER
    INTO v_dead_letters
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_retry_queue AS q
      ON q.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events';

    SELECT count(*)::INTEGER
    INTO v_queued
    FROM pgmq."q_runtime-events" AS q
    JOIN pg_temp.p2_retry_queue AS fixture
      ON fixture.message_id = q.msg_id;

    INSERT INTO pg_temp.p2_retry_observation (
      iteration, result_failed, processing_attempts, last_failure_class,
      dead_letter_count, active_queue_count
    )
    VALUES (
      v_iteration, COALESCE(v_failed, 0), v_attempts, v_failure_class,
      v_dead_letters, v_queued
    );
  END LOOP;
END;
$p2_retry_loop$;

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM pg_temp.p2_retry_observation
    WHERE iteration BETWEEN 1 AND 4
      AND result_failed = 1
      AND last_failure_class = 'retryable'
      AND dead_letter_count = 0
      AND active_queue_count = 1
  ),
  4,
  'first four real worker attempts remain retryable and retain one active queue message'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM pg_temp.p2_retry_observation
    WHERE iteration = 5
      AND result_failed = 1
      AND processing_attempts = 5
      AND last_failure_class = 'retry_exhausted'
      AND dead_letter_count = 1
      AND active_queue_count = 0
  ),
  1,
  'fifth real worker attempt reaches retry_exhausted and archives the queue message'
);

SELECT is(
  (
    SELECT d.read_count
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_retry_queue AS q ON q.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  5,
  'retry-exhausted dead letter records five reads'
);

SELECT is(
  (
    SELECT d.failure_code
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_retry_queue AS q ON q.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  '40001',
  'retry exhaustion preserves the retryable SQLSTATE that caused all five failures'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.moment_occurrences
    WHERE event_id = '00000000-0000-4000-8000-000000000305'::UUID
  ),
  0,
  'failed runtime processing rolls back all Moment Occurrence writes'
);

SELECT is(
  (
    SELECT result_failed
    FROM public.runtime_worker_tick(1, 5)
  ),
  0,
  'an already archived retry-exhausted message is not attempted again'
);

-- Inject one archive failure transactionally by overriding the PGMQ archive
-- function, preserve its original definition, then restore it before testing
-- the worker's next-pass recovery path.
CREATE TEMP TABLE p2_archive_original_definition AS
SELECT pg_catalog.pg_get_functiondef('pgmq.archive(text,bigint)'::REGPROCEDURE) AS ddl;

CREATE OR REPLACE FUNCTION pgmq.archive(queue_name TEXT, msg_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $p2_archive_mock$
BEGIN
  RETURN FALSE;
END;
$p2_archive_mock$;

CREATE TEMP TABLE p2_archive_failure_queue AS
SELECT pgmq.send(
  'runtime-events',
  pg_catalog.jsonb_build_object('event_id', 'not-a-valid-event-for-archive-retry')
) AS message_id;

SELECT is(
  (
    SELECT private.runtime_quarantine_message(
      q.message_id,
      5,
      timezone('utc'::text, now()),
      '{"p2":"archive-failure-recovery"}'::JSONB,
      NULL,
      NULL,
      'malformed',
      'p2_archive_injected_failure',
      'P2 injected archive failure'
    )
    FROM pg_temp.p2_archive_failure_queue AS q
  ),
  FALSE,
  'quarantine returns false and leaves the queue row when archive fails'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_archive_failure_queue AS q
      ON q.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  1,
  'archive failure still durably records the dead-letter metadata in the transaction'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM pgmq."q_runtime-events" AS current_queue
    JOIN pg_temp.p2_archive_failure_queue AS q
      ON q.message_id = current_queue.msg_id
  ),
  1,
  'archive failure leaves the message available for a later archival retry'
);

DO $p2_restore_archive$
DECLARE
  v_original_definition TEXT;
BEGIN
  SELECT ddl
  INTO v_original_definition
  FROM pg_temp.p2_archive_original_definition;
  EXECUTE v_original_definition;
END;
$p2_restore_archive$;

UPDATE pgmq."q_runtime-events"
SET vt = clock_timestamp() - INTERVAL '1 second'
WHERE msg_id = (SELECT message_id FROM pg_temp.p2_archive_failure_queue);

SELECT is(
  (
    SELECT w.result_failed
    FROM public.runtime_worker_tick(1, 5) AS w
  ),
  1,
  'the actual worker recognizes the existing dead letter and retries archival'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM pgmq."q_runtime-events" AS current_queue
    JOIN pg_temp.p2_archive_failure_queue AS q
      ON q.message_id = current_queue.msg_id
  ),
  0,
  'archive retry removes the previously stuck active queue message'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.runtime_dead_letters AS d
    JOIN pg_temp.p2_archive_failure_queue AS q
      ON q.message_id = d.queue_message_id
    WHERE d.queue_name = 'runtime-events'
  ),
  1,
  'archive retry does not duplicate the existing dead-letter row'
);

SELECT * FROM finish();
ROLLBACK;
