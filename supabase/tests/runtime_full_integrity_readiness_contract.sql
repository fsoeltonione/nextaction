BEGIN;
SELECT plan(24);

-- Replace scheduler fixtures inside this transaction. ROLLBACK restores the
-- original local pg_cron state after exercising ready and fail-closed branches.
CREATE TEMP TABLE p2_readiness_jobs (
  job_name TEXT PRIMARY KEY,
  job_id BIGINT NOT NULL
);

DO $p2_unschedule$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'nextaction-runtime-worker',
      'nextaction-runtime-operations',
      'nextaction-runtime-integrity-audit'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$p2_unschedule$;

INSERT INTO pg_temp.p2_readiness_jobs (job_name, job_id)
VALUES
  ('worker', cron.schedule('nextaction-runtime-worker', '* * * * *', 'SELECT 1')),
  ('operations', cron.schedule('nextaction-runtime-operations', '* * * * *', 'SELECT 1')),
  ('integrity', cron.schedule('nextaction-runtime-integrity-audit', '* * * * *', 'SELECT 1'));

CREATE OR REPLACE FUNCTION pg_temp.p2_readiness_record_run(
  p_job_id BIGINT,
  p_status TEXT,
  p_age INTERVAL
)
RETURNS VOID
LANGUAGE plpgsql
AS $record_run$
BEGIN
  INSERT INTO cron.job_run_details (
    runid, jobid, database, username, command, status,
    return_message, start_time, end_time
  )
  SELECT
    COALESCE((SELECT max(d.runid) + 1 FROM cron.job_run_details AS d), 1),
    j.jobid, j.database, j.username, j.command, p_status,
    'P2 disposable readiness fixture',
    clock_timestamp() - p_age,
    clock_timestamp()
  FROM cron.job AS j
  WHERE j.jobid = p_job_id;
END;
$record_run$;

SELECT pg_temp.p2_readiness_record_run(job_id, 'succeeded', INTERVAL '0 seconds')
FROM pg_temp.p2_readiness_jobs;

DELETE FROM private.runtime_integrity_snapshots;
INSERT INTO private.runtime_integrity_snapshots (status, anomaly_count, metrics, checked_at)
VALUES ('ok', 0, '{"source":"p2-disposable-contract"}'::JSONB, clock_timestamp());

SELECT ok(
  position('nextaction-runtime-integrity-audit' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness implementation names the integrity-audit scheduler'
);

SELECT ok(
  position('private.runtime_integrity_snapshots' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness implementation inspects persisted integrity snapshots'
);

SELECT ok(
  position('v_integrity_audit_recent_success' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness implementation requires a recent successful integrity-audit run'
);

SELECT ok(
  position('v_integrity_snapshot_healthy' IN pg_get_functiondef('public.runtime_readiness()'::REGPROCEDURE)) > 0,
  'readiness implementation requires a fresh zero-anomaly OK snapshot'
);

SELECT ok(
  (public.runtime_readiness() ? 'integrity_audit')
    AND (public.runtime_readiness() ? 'integrity_snapshot'),
  'readiness output separates scheduler and latest-snapshot diagnostics'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_audit'->>'schedule_active' = 'true'),
  'ready output cannot coexist with an inactive integrity-audit schedule'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_audit'->>'recent_success' = 'true'),
  'ready output cannot coexist with a missing or stale integrity-audit success'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (public.runtime_readiness()->'integrity_snapshot'->>'fresh_and_healthy' = 'true'),
  'ready output cannot coexist with a stale or anomalous integrity snapshot'
);

SELECT ok(
  (public.runtime_readiness()->>'status' <> 'ready')
  OR (
    public.runtime_readiness()->'worker'->>'schedule_active' = 'true'
    AND public.runtime_readiness()->'worker'->>'recent_success' = 'true'
    AND public.runtime_readiness()->'operations'->>'schedule_active' = 'true'
    AND public.runtime_readiness()->'operations'->>'recent_success' = 'true'
  ),
  'ready output requires active worker and operations schedules with recent successes'
);

SELECT is(public.runtime_readiness()->>'status', 'ready',
  'fresh successful worker, operations and integrity runs plus a fresh zero-anomaly snapshot produce ready');

UPDATE cron.job SET active = FALSE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker');
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'inactive worker schedule forces not_ready');
UPDATE cron.job SET active = TRUE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker');

DELETE FROM cron.job_run_details
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker'),
  'succeeded', INTERVAL '4 minutes'
);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'stale worker success forces not_ready');

DELETE FROM cron.job_run_details
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker'),
  'failed', INTERVAL '5 seconds'
);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'latest failed worker run forces not_ready');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'worker'),
  'succeeded', INTERVAL '0 seconds'
);

UPDATE cron.job SET active = FALSE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'operations');
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'inactive operations schedule forces not_ready');
UPDATE cron.job SET active = TRUE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'operations');

DELETE FROM cron.job_run_details
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'operations');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'operations'),
  'succeeded', INTERVAL '11 minutes'
);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'stale operations success forces not_ready');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'operations'),
  'succeeded', INTERVAL '0 seconds'
);

UPDATE cron.job SET active = FALSE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity');
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'inactive integrity-audit schedule forces not_ready');
UPDATE cron.job SET active = TRUE
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity');

DELETE FROM cron.job_run_details
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity'),
  'succeeded', INTERVAL '11 minutes'
);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'stale integrity-audit success forces not_ready');

DELETE FROM cron.job_run_details
WHERE jobid = (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity'),
  'failed', INTERVAL '5 seconds'
);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'latest failed integrity-audit run forces not_ready');
SELECT pg_temp.p2_readiness_record_run(
  (SELECT job_id FROM pg_temp.p2_readiness_jobs WHERE job_name = 'integrity'),
  'succeeded', INTERVAL '0 seconds'
);

UPDATE private.runtime_integrity_snapshots
SET status = 'critical'
WHERE id = (SELECT id FROM private.runtime_integrity_snapshots ORDER BY checked_at DESC LIMIT 1);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'critical integrity snapshot forces not_ready');

UPDATE private.runtime_integrity_snapshots
SET status = 'warning', anomaly_count = 0, checked_at = clock_timestamp()
WHERE id = (SELECT id FROM private.runtime_integrity_snapshots ORDER BY checked_at DESC LIMIT 1);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'warning snapshot status is not accepted as healthy');

UPDATE private.runtime_integrity_snapshots
SET status = 'ok', anomaly_count = 1, checked_at = clock_timestamp()
WHERE id = (SELECT id FROM private.runtime_integrity_snapshots ORDER BY checked_at DESC LIMIT 1);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'nonzero anomaly count forces not_ready');

UPDATE private.runtime_integrity_snapshots
SET status = 'ok', anomaly_count = 0, checked_at = clock_timestamp() - INTERVAL '11 minutes'
WHERE id = (SELECT id FROM private.runtime_integrity_snapshots ORDER BY checked_at DESC LIMIT 1);
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'stale healthy snapshot forces not_ready');

DELETE FROM private.runtime_integrity_snapshots;
SELECT is(public.runtime_readiness()->>'status', 'not_ready', 'missing integrity snapshot forces not_ready');

INSERT INTO private.runtime_integrity_snapshots (status, anomaly_count, metrics, checked_at)
VALUES ('ok', 0, '{"source":"p2-disposable-contract-restored"}'::JSONB, clock_timestamp());
SELECT is(
  public.runtime_readiness()->>'status',
  'ready',
  'readiness returns to ready only after schedules and the fresh zero-anomaly snapshot are healthy again'
);

SELECT * FROM finish();
ROLLBACK;
