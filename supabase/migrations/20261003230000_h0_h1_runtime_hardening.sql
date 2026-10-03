-- NextAction H0/H1 hardening: runtime integrity observability.
BEGIN;

-- H1: immutable-ish monitoring snapshots. The table is private, RLS-protected,
-- and never exposed to anon/authenticated. Rows are monitoring history only.
CREATE TABLE IF NOT EXISTS private.runtime_integrity_snapshots (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'critical')),
  anomaly_count INTEGER NOT NULL CHECK (anomaly_count >= 0),
  metrics JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS runtime_integrity_snapshots_checked_at_idx
  ON private.runtime_integrity_snapshots (checked_at DESC);

ALTER TABLE private.runtime_integrity_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.runtime_integrity_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE private.runtime_integrity_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.runtime_integrity_audit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $audit$
DECLARE
  v_checked_at TIMESTAMPTZ := timezone('utc'::text, now());
  v_queue_count INTEGER := 0;
  v_queue_oldest_age_seconds INTEGER := 0;
  v_queue_average_age_seconds INTEGER := 0;
  v_nonterminal_event_count INTEGER := 0;
  v_stale_event_count INTEGER := 0;
  v_financial_mismatch_count INTEGER := 0;
  v_settlement_split_mismatch_count INTEGER := 0;
  v_duplicate_settlement_count INTEGER := 0;
  v_duplicate_consumption_count INTEGER := 0;
  v_orphan_financial_entry_count INTEGER := 0;
  v_settlement_without_qualified_click_count INTEGER := 0;
  v_unsettled_qualified_click_count INTEGER := 0;
  v_credit_account_mismatch_count INTEGER := 0;
  v_negative_credit_account_count INTEGER := 0;
  v_status TEXT;
  v_anomaly_count INTEGER;
  v_metrics JSONB;
BEGIN
  -- Queue depth + latency are read-only checks against the existing PGMQ table.
  SELECT
    count(*)::INTEGER,
    COALESCE(
      EXTRACT(EPOCH FROM (v_checked_at - min(enqueued_at)))::INTEGER,
      0
    ),
    COALESCE(
      EXTRACT(
        EPOCH FROM (
          SELECT avg(v_checked_at - q.enqueued_at)
          FROM pgmq."q_runtime-events" AS q
        )
      )::INTEGER,
      0
    )
  INTO
    v_queue_count,
    v_queue_oldest_age_seconds,
    v_queue_average_age_seconds
  FROM pgmq."q_runtime-events";

  SELECT count(*)::INTEGER
  INTO v_nonterminal_event_count
  FROM private.events
  WHERE processing_status <> 'processed';

  SELECT count(*)::INTEGER
  INTO v_stale_event_count
  FROM private.events
  WHERE processing_status <> 'processed'
    AND received_at < v_checked_at - INTERVAL '5 minutes';

  SELECT count(*)::INTEGER
  INTO v_financial_mismatch_count
  FROM (
    SELECT s.id
    FROM private.settlements AS s
    LEFT JOIN private.financial_entries AS fe
      ON fe.settlement_id = s.id
    GROUP BY s.id
    HAVING count(fe.id) <> 3
       OR COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'debit'), 0)
            <> s.charge_cents
       OR COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'credit'), 0)
            <> s.charge_cents
  ) AS invalid_settlements;

  SELECT count(*)::INTEGER
  INTO v_settlement_split_mismatch_count
  FROM private.settlements
  WHERE publisher_share_cents + platform_share_cents <> charge_cents
     OR charge_cents <> 100
     OR publisher_share_cents <> 75
     OR platform_share_cents <> 25
     OR currency <> 'USD';

  SELECT count(*)::INTEGER
  INTO v_duplicate_settlement_count
  FROM (
    SELECT qualified_click_id
    FROM private.settlements
    GROUP BY qualified_click_id
    HAVING count(*) > 1
  ) AS duplicates;

  SELECT count(*)::INTEGER
  INTO v_duplicate_consumption_count
  FROM (
    SELECT workspace_id, reference_id
    FROM private.advertiser_credit_entries
    WHERE entry_type = 'consumption'
      AND reference_id IS NOT NULL
    GROUP BY workspace_id, reference_id
    HAVING count(*) > 1
  ) AS duplicates;

  SELECT count(*)::INTEGER
  INTO v_orphan_financial_entry_count
  FROM private.financial_entries AS fe
  LEFT JOIN private.settlements AS s
    ON s.id = fe.settlement_id
  WHERE s.id IS NULL;

  SELECT count(*)::INTEGER
  INTO v_settlement_without_qualified_click_count
  FROM private.settlements AS s
  LEFT JOIN private.qualified_clicks AS qc
    ON qc.id = s.qualified_click_id
  WHERE qc.id IS NULL;

  -- A qualified click can legitimately remain unsettled when capacity is zero.
  -- This metric is therefore a warning signal, not a hard-failure invariant.
  SELECT count(*)::INTEGER
  INTO v_unsettled_qualified_click_count
  FROM private.qualified_clicks AS qc
  LEFT JOIN private.settlements AS s
    ON s.qualified_click_id = qc.id
  WHERE s.id IS NULL
    AND qc.qualified_at < v_checked_at - INTERVAL '5 minutes';

  SELECT count(*)::INTEGER
  INTO v_credit_account_mismatch_count
  FROM private.advertiser_credit_accounts
  WHERE available_units <> granted_units - consumed_units;

  SELECT count(*)::INTEGER
  INTO v_negative_credit_account_count
  FROM private.advertiser_credit_accounts
  WHERE granted_units < 0
     OR consumed_units < 0
     OR available_units < 0;

  v_anomaly_count :=
      CASE WHEN v_queue_oldest_age_seconds > 60 THEN 1 ELSE 0 END
    + v_stale_event_count
    + v_financial_mismatch_count
    + v_settlement_split_mismatch_count
    + v_duplicate_settlement_count
    + v_duplicate_consumption_count
    + v_orphan_financial_entry_count
    + v_settlement_without_qualified_click_count
    + v_unsettled_qualified_click_count
    + v_credit_account_mismatch_count
    + v_negative_credit_account_count;

  IF (
    v_financial_mismatch_count > 0
    OR v_settlement_split_mismatch_count > 0
    OR v_duplicate_settlement_count > 0
    OR v_duplicate_consumption_count > 0
    OR v_orphan_financial_entry_count > 0
    OR v_settlement_without_qualified_click_count > 0
    OR v_credit_account_mismatch_count > 0
    OR v_negative_credit_account_count > 0
  ) THEN
    v_status := 'critical';
  ELSIF (
    v_queue_oldest_age_seconds > 60
    OR v_stale_event_count > 0
    OR v_unsettled_qualified_click_count > 0
    OR v_nonterminal_event_count > 0
  ) THEN
    v_status := 'warning';
  ELSE
    v_status := 'ok';
  END IF;

  v_metrics := pg_catalog.jsonb_build_object(
    'checked_at', v_checked_at,
    'queue', pg_catalog.jsonb_build_object(
      'count', v_queue_count,
      'oldest_age_seconds', v_queue_oldest_age_seconds,
      'average_age_seconds', v_queue_average_age_seconds
    ),
    'events', pg_catalog.jsonb_build_object(
      'nonterminal_count', v_nonterminal_event_count,
      'stale_nonterminal_count', v_stale_event_count
    ),
    'settlements', pg_catalog.jsonb_build_object(
      'financial_mismatch_count', v_financial_mismatch_count,
      'split_mismatch_count', v_settlement_split_mismatch_count,
      'duplicate_count', v_duplicate_settlement_count,
      'without_qualified_click_count', v_settlement_without_qualified_click_count,
      'unsettled_qualified_click_count', v_unsettled_qualified_click_count
    ),
    'credits', pg_catalog.jsonb_build_object(
      'duplicate_consumption_count', v_duplicate_consumption_count,
      'account_mismatch_count', v_credit_account_mismatch_count,
      'negative_account_count', v_negative_credit_account_count
    ),
    'ledger', pg_catalog.jsonb_build_object(
      'orphan_financial_entry_count', v_orphan_financial_entry_count
    ),
    'anomaly_count', v_anomaly_count
  );

  INSERT INTO private.runtime_integrity_snapshots (
    checked_at,
    status,
    anomaly_count,
    metrics
  )
  VALUES (
    v_checked_at,
    v_status,
    v_anomaly_count,
    v_metrics
  );

  -- Keep monitoring history bounded without touching any business data.
  DELETE FROM private.runtime_integrity_snapshots
  WHERE checked_at < v_checked_at - INTERVAL '30 days';

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'anomaly_count', v_anomaly_count,
    'metrics', v_metrics
  );
END;
$audit$;

REVOKE ALL ON FUNCTION public.runtime_integrity_audit()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_integrity_audit()
  TO service_role;

-- H1: one privileged read path for operators/automated checks.
CREATE OR REPLACE FUNCTION public.runtime_integrity_latest()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $latest$
  SELECT COALESCE(
    (
      SELECT pg_catalog.jsonb_build_object(
        'id', s.id,
        'checked_at', s.checked_at,
        'status', s.status,
        'anomaly_count', s.anomaly_count,
        'metrics', s.metrics
      )
      FROM private.runtime_integrity_snapshots AS s
      ORDER BY s.checked_at DESC
      LIMIT 1
    ),
    pg_catalog.jsonb_build_object(
      'status', 'unknown',
      'anomaly_count', 0,
      'metrics', pg_catalog.jsonb_build_object()
    )
  );
$latest$;

REVOKE ALL ON FUNCTION public.runtime_integrity_latest()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_integrity_latest()
  TO service_role;

-- H0 deployment-time guards for the financial invariants already required by
-- the runtime. Fail closed if the canonical constraints disappear.
DO $guards$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'settlements_qualified_click_id_key'
      AND conrelid = 'private.settlements'::regclass
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'H0 guard failed: settlement uniqueness constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'advertiser_credit_accounts_check'
      AND conrelid = 'private.advertiser_credit_accounts'::regclass
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'H0 guard failed: advertiser credit balance invariant is missing';
  END IF;
END;
$guards$;

-- Supabase Cron must be changed through cron functions, not cron.job writes.
-- Scheduling an existing job name replaces that job definition.
SELECT cron.schedule(
  'nextaction-runtime-integrity-audit',
  '*/5 * * * *',
  'SELECT public.runtime_integrity_audit();'
);

COMMIT;
