-- NextAction H1 follow-up: keep smoke canaries out of business analytics/integrity metrics.
BEGIN;

CREATE TABLE IF NOT EXISTS private.runtime_excluded_workspaces (
  workspace_id UUID PRIMARY KEY
    REFERENCES public.workspaces(id)
    ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE private.runtime_excluded_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.runtime_excluded_workspaces FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE private.runtime_excluded_workspaces TO service_role;

DROP POLICY IF EXISTS runtime_excluded_workspaces_no_access
  ON private.runtime_excluded_workspaces;

CREATE POLICY runtime_excluded_workspaces_no_access
  ON private.runtime_excluded_workspaces
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Register the two fixed smoke workspaces when they exist. Fresh environments
-- simply get an empty registry until the smoke fixture creates its canaries.
INSERT INTO private.runtime_excluded_workspaces (workspace_id, reason)
SELECT w.id, 'production/staging smoke canary'
FROM public.workspaces AS w
WHERE w.name IN (
  '__nextaction_prod_smoke_publisher',
  '__nextaction_prod_smoke_advertiser'
)
ON CONFLICT (workspace_id) DO UPDATE
SET reason = EXCLUDED.reason;

CREATE OR REPLACE FUNCTION public.runtime_integrity_audit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $audit_h1$
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
  v_excluded_workspace_count INTEGER := 0;
  v_status TEXT;
  v_anomaly_count INTEGER;
  v_metrics JSONB;
BEGIN
  SELECT count(*)::INTEGER
  INTO v_excluded_workspace_count
  FROM private.runtime_excluded_workspaces;

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
  FROM private.events AS e
  WHERE e.processing_status <> 'processed'
    AND NOT EXISTS (
      SELECT 1
      FROM public.integrations AS i
      JOIN public.products AS p ON p.id = i.product_id
      JOIN private.runtime_excluded_workspaces AS x
        ON x.workspace_id = p.workspace_id
      WHERE i.id = e.integration_id
    );

  SELECT count(*)::INTEGER
  INTO v_stale_event_count
  FROM private.events AS e
  WHERE e.processing_status <> 'processed'
    AND e.received_at < v_checked_at - INTERVAL '5 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.integrations AS i
      JOIN public.products AS p ON p.id = i.product_id
      JOIN private.runtime_excluded_workspaces AS x
        ON x.workspace_id = p.workspace_id
      WHERE i.id = e.integration_id
    );

  SELECT count(*)::INTEGER
  INTO v_financial_mismatch_count
  FROM (
    SELECT s.id
    FROM private.settlements AS s
    LEFT JOIN private.financial_entries AS fe
      ON fe.settlement_id = s.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id IN (
        s.advertiser_workspace_id,
        s.publisher_workspace_id
      )
    )
    GROUP BY s.id
    HAVING count(fe.id) <> 3
       OR COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'debit'), 0)
            <> s.charge_cents
       OR COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'credit'), 0)
            <> s.charge_cents
  ) AS invalid_settlements;

  SELECT count(*)::INTEGER
  INTO v_settlement_split_mismatch_count
  FROM private.settlements AS s
  WHERE NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id IN (
        s.advertiser_workspace_id,
        s.publisher_workspace_id
      )
    )
    AND (
      s.publisher_share_cents + s.platform_share_cents <> s.charge_cents
      OR s.charge_cents <> 100
      OR s.publisher_share_cents <> 75
      OR s.platform_share_cents <> 25
      OR s.currency <> 'USD'
    );

  SELECT count(*)::INTEGER
  INTO v_duplicate_settlement_count
  FROM (
    SELECT s.qualified_click_id
    FROM private.settlements AS s
    WHERE NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id IN (
        s.advertiser_workspace_id,
        s.publisher_workspace_id
      )
    )
    GROUP BY s.qualified_click_id
    HAVING count(*) > 1
  ) AS duplicates;

  SELECT count(*)::INTEGER
  INTO v_duplicate_consumption_count
  FROM (
    SELECT e.workspace_id, e.reference_id
    FROM private.advertiser_credit_entries AS e
    WHERE e.entry_type = 'consumption'
      AND e.reference_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM private.runtime_excluded_workspaces AS x
        WHERE x.workspace_id = e.workspace_id
      )
    GROUP BY e.workspace_id, e.reference_id
    HAVING count(*) > 1
  ) AS duplicates;

  SELECT count(*)::INTEGER
  INTO v_orphan_financial_entry_count
  FROM private.financial_entries AS fe
  LEFT JOIN private.settlements AS s
    ON s.id = fe.settlement_id
  WHERE s.id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      JOIN private.financial_accounts AS a
        ON a.workspace_id = x.workspace_id
      WHERE a.id = fe.account_id
    );

  SELECT count(*)::INTEGER
  INTO v_settlement_without_qualified_click_count
  FROM private.settlements AS s
  LEFT JOIN private.qualified_clicks AS qc
    ON qc.id = s.qualified_click_id
  WHERE qc.id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id IN (
        s.advertiser_workspace_id,
        s.publisher_workspace_id
      )
    );

  SELECT count(*)::INTEGER
  INTO v_unsettled_qualified_click_count
  FROM private.qualified_clicks AS qc
  JOIN private.clicks AS c
    ON c.id = qc.click_id
  JOIN private.deliveries AS d
    ON d.id = c.delivery_id
  JOIN public.offers AS o
    ON o.id = d.offer_id
  LEFT JOIN private.settlements AS s
    ON s.qualified_click_id = qc.id
  WHERE s.id IS NULL
    AND qc.qualified_at < v_checked_at - INTERVAL '5 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id = o.workspace_id
    );

  SELECT count(*)::INTEGER
  INTO v_credit_account_mismatch_count
  FROM private.advertiser_credit_accounts AS a
  WHERE a.available_units <> a.granted_units - a.consumed_units
    AND NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id = a.workspace_id
    );

  SELECT count(*)::INTEGER
  INTO v_negative_credit_account_count
  FROM private.advertiser_credit_accounts AS a
  WHERE (
      a.granted_units < 0
      OR a.consumed_units < 0
      OR a.available_units < 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM private.runtime_excluded_workspaces AS x
      WHERE x.workspace_id = a.workspace_id
    );

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
    'excluded_workspace_count', v_excluded_workspace_count,
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

  DELETE FROM private.runtime_integrity_snapshots
  WHERE checked_at < v_checked_at - INTERVAL '30 days';

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'anomaly_count', v_anomaly_count,
    'metrics', v_metrics
  );
END;
$audit_h1$;

REVOKE ALL ON FUNCTION public.runtime_integrity_audit()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_integrity_audit()
  TO service_role;

COMMIT;
