-- Staging-only executable copy of supabase/migrations/20260926050000_stage_9_runtime_rate_limit_reconciliation.sql
-- Required because the historical migration source contains parser-sensitive
-- qualified forms of SQL special syntax (EXTRACT/TRIM). This file preserves
-- the same intended runtime objects without changing the historical migration.
-- NextAction Stage 9: rate-limit concurrency reconciliation
-- Captures the live atomic-upsert implementation so fresh environments do not
-- reproduce the race-prone first-request INSERT path.
BEGIN;

CREATE OR REPLACE FUNCTION public.check_runtime_rate_limit(
  p_scope TEXT,
  p_subject_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER,
  request_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_scope IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_scope)) < 1
     OR pg_catalog.length(p_scope) > 100
  THEN
    RAISE EXCEPTION 'invalid rate limit scope' USING ERRCODE = '22023';
  END IF;

  IF p_subject_hash IS NULL
     OR p_subject_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid rate limit subject' USING ERRCODE = '22023';
  END IF;

  IF p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'invalid rate limit limit' USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit window' USING ERRCODE = '22023';
  END IF;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM v_now) / p_window_seconds
    ) * p_window_seconds
  );
  v_window_end := v_window_start
    + pg_catalog.make_interval(secs => p_window_seconds);

  INSERT INTO private.rate_limit_buckets AS b (
    scope,
    subject_hash,
    window_started_at,
    request_count
  )
  VALUES (
    pg_catalog.btrim(p_scope),
    p_subject_hash,
    v_window_start,
    1
  )
  ON CONFLICT (scope, subject_hash)
  DO UPDATE
  SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN b.window_started_at = EXCLUDED.window_started_at
        THEN b.request_count + 1
      ELSE 1
    END
  RETURNING b.request_count
  INTO v_count;

  RETURN QUERY
  SELECT
    v_count <= p_limit,
    pg_catalog.greatest(p_limit - v_count, 0),
    pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch FROM (v_window_end - pg_catalog.clock_timestamp())
        )
      )::INTEGER
    ),
    v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.check_runtime_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_runtime_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;

COMMIT;
