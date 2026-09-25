-- NextAction Stage 9: runtime surface cleanup
BEGIN;

DROP FUNCTION IF EXISTS public.runtime_ack_event(BIGINT);
DROP FUNCTION IF EXISTS public.runtime_dequeue_events(INTEGER, INTEGER);

REVOKE ALL ON SCHEMA pgmq FROM PUBLIC, anon, authenticated;

COMMIT;
