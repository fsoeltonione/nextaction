-- NextAction Stage 6 hardening follow-up
-- Fixes grant inheritance, remaining FK indexes, private-schema defense in depth,
-- and the workspace membership INSERT policy ambiguity found during verification.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Explicitly remove legacy anonymous grants.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workspace_capabilities,
  public.products,
  public.moments,
  public.integrations,
  public.offers,
  public.offer_moments
FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Cover every newly introduced foreign key used by runtime/financial paths.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS decisions_moment_occurrence_id_idx
  ON private.decisions(moment_occurrence_id);

CREATE INDEX IF NOT EXISTS decisions_offer_id_idx
  ON private.decisions(offer_id);

CREATE INDEX IF NOT EXISTS deliveries_decision_id_idx
  ON private.deliveries(decision_id);

CREATE INDEX IF NOT EXISTS deliveries_offer_id_idx
  ON private.deliveries(offer_id);

CREATE INDEX IF NOT EXISTS financial_entries_account_id_idx
  ON private.financial_entries(account_id);

CREATE INDEX IF NOT EXISTS moment_occurrences_event_id_idx
  ON private.moment_occurrences(event_id);

CREATE INDEX IF NOT EXISTS moment_occurrences_integration_id_idx
  ON private.moment_occurrences(integration_id);

-- ---------------------------------------------------------------------------
-- 3. Defense in depth: private tables are also protected by RLS.
-- No authenticated/anon grants exist on these tables, and service_role/server
-- paths are the intended runtime access boundary.
-- ---------------------------------------------------------------------------

ALTER TABLE private.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.moment_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.qualified_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advertiser_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advertiser_credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.settlements ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Replace the first migration's ambiguous membership INSERT policy with the
-- verified form. Authorization remains membership/creator based.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS workspace_members_insert
  ON public.workspace_members;

CREATE POLICY workspace_members_insert
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  (
    user_id = (SELECT auth.uid())
    AND role = 'owner'
    AND EXISTS (
      SELECT 1
      FROM public.workspaces AS w
      WHERE w.id = public.workspace_members.workspace_id
        AND w.created_by = (SELECT auth.uid())
    )
  )
  OR
  (
    role = 'member'
    AND (SELECT private.current_workspace_role(public.workspace_members.workspace_id)) = 'owner'
  )
);

COMMIT;
