-- NextAction Stage 6: production foundation
-- This migration is intentionally safe for the current remote prototype:
-- - preserves existing IDs, timestamps, relationships, and rows
-- - backfills workspace membership and canonical product URLs
-- - keeps legacy prototype columns temporarily for application cutover
-- - adds the production control-plane, runtime, and financial foundation
--
-- GitHub migrations are the schema source of truth. This file is designed to
-- execute both against the current remote database and against a fresh DB
-- that starts without the prototype tables.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------
-- 1. Existing workspace normalization
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS created_by UUID;

UPDATE public.workspaces
SET created_by = user_id
WHERE created_by IS NULL
  AND user_id IS NOT NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN created_by SET DEFAULT auth.uid(),
  ALTER COLUMN created_by SET NOT NULL;

COMMENT ON COLUMN public.workspaces.user_id IS
  'DEPRECATED compatibility field. Authorization is based on workspace_members, not user_id.';

COMMENT ON COLUMN public.workspaces.created_by IS
  'Provenance field for the workspace creator. Authorization is based on workspace_members.';

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx
  ON public.workspace_members(user_id);

INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, w.user_id, 'owner'
FROM public.workspaces AS w
WHERE w.user_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Small internal authorization helpers. They live outside exposed schemas and
-- use a fixed search_path as required for SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION private.current_workspace_role(p_workspace_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT wm.role
  FROM public.workspace_members AS wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_workspace_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_workspace_role(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Capability model
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspace_capabilities (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (capability IN ('make_money', 'reach_customers')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (workspace_id, capability)
);

CREATE INDEX IF NOT EXISTS workspace_capabilities_status_idx
  ON public.workspace_capabilities(workspace_id, status);

-- ---------------------------------------------------------------------------
-- 3. Product + Moment normalization
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS understanding_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (understanding_status IN ('proposed', 'confirmed', 'archived')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
    DEFAULT timezone('utc'::text, now());

UPDATE public.products
SET canonical_url = CASE
  WHEN lower(domain) ~ '^https?://' THEN rtrim(lower(domain), '/')
  ELSE 'https://' || rtrim(lower(domain), '/')
END
WHERE canonical_url IS NULL;

UPDATE public.products
SET understanding_status = 'confirmed'
WHERE understanding_status = 'proposed';

UPDATE public.products
SET updated_at = created_at
WHERE updated_at = timezone('utc'::text, now())
  AND created_at IS NOT NULL;

ALTER TABLE public.products
  ALTER COLUMN canonical_url SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_canonical_url_uq
  ON public.products(workspace_id, canonical_url);

CREATE INDEX IF NOT EXISTS products_workspace_id_idx
  ON public.products(workspace_id);

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
    DEFAULT timezone('utc'::text, now());

UPDATE public.moments
SET updated_at = created_at
WHERE updated_at = timezone('utc'::text, now())
  AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS moments_product_id_idx
  ON public.moments(product_id);

-- ---------------------------------------------------------------------------
-- 4. Integration model
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  UNIQUE (product_id, name)
);

CREATE INDEX IF NOT EXISTS integrations_product_status_idx
  ON public.integrations(product_id, status);

CREATE TABLE IF NOT EXISTS private.integration_secrets (
  integration_id UUID PRIMARY KEY REFERENCES public.integrations(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  rotated_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 5. Offer model + relational targeting
-- ---------------------------------------------------------------------------

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS destination_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
    DEFAULT timezone('utc'::text, now());

UPDATE public.offers
SET destination_url = cta_url
WHERE destination_url IS NULL;

ALTER TABLE public.offers
  ALTER COLUMN destination_url SET NOT NULL;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_status_check;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_status_check_v2
  CHECK (status IN ('draft', 'active', 'paused', 'exhausted', 'archived'));

UPDATE public.offers
SET updated_at = created_at
WHERE updated_at = timezone('utc'::text, now())
  AND created_at IS NOT NULL;

COMMENT ON COLUMN public.offers.cta_url IS
  'DEPRECATED compatibility field. Use destination_url as the authoritative trusted destination.';

COMMENT ON COLUMN public.offers.target_moments IS
  'DEPRECATED compatibility field. Use offer_moments for authoritative targeting.';

COMMENT ON COLUMN public.offers.budget_cents IS
  'DEPRECATED prototype field. Advertiser capacity is represented by private.advertiser_credit_accounts.';

COMMENT ON COLUMN public.offers.spent_cents IS
  'DEPRECATED prototype field. Settlement accounting is represented by private financial ledgers.';

CREATE INDEX IF NOT EXISTS offers_workspace_id_idx
  ON public.offers(workspace_id);

CREATE TABLE IF NOT EXISTS public.offer_moments (
  offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  moment_id UUID NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (offer_id, moment_id)
);

CREATE INDEX IF NOT EXISTS offer_moments_moment_id_idx
  ON public.offer_moments(moment_id);

CREATE OR REPLACE FUNCTION private.validate_offer_moment_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  offer_workspace UUID;
  moment_workspace UUID;
BEGIN
  SELECT o.workspace_id
  INTO offer_workspace
  FROM public.offers AS o
  WHERE o.id = NEW.offer_id;

  SELECT p.workspace_id
  INTO moment_workspace
  FROM public.moments AS m
  JOIN public.products AS p ON p.id = m.product_id
  WHERE m.id = NEW.moment_id;

  IF offer_workspace IS NULL OR moment_workspace IS NULL OR offer_workspace <> moment_workspace THEN
    RAISE EXCEPTION 'offer and moment must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_offer_moment_tenant
  ON public.offer_moments;

CREATE TRIGGER trg_validate_offer_moment_tenant
BEFORE INSERT OR UPDATE ON public.offer_moments
FOR EACH ROW
EXECUTE FUNCTION private.validate_offer_moment_tenant();

-- ---------------------------------------------------------------------------
-- 6. Runtime domain
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  processing_status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (processing_status IN ('accepted', 'processing', 'processed', 'failed')),
  request_id UUID,
  UNIQUE (integration_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS events_integration_received_idx
  ON private.events(integration_id, received_at DESC);

CREATE TABLE IF NOT EXISTS private.moment_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id UUID NOT NULL REFERENCES public.moments(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES private.events(id) ON DELETE SET NULL,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS moment_occurrences_moment_occurred_idx
  ON private.moment_occurrences(moment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS private.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_occurrence_id UUID REFERENCES private.moment_occurrences(id) ON DELETE RESTRICT,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('filled', 'no_fill', 'rejected', 'error')),
  offer_id UUID REFERENCES public.offers(id) ON DELETE RESTRICT,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  request_id UUID
);

CREATE INDEX IF NOT EXISTS decisions_integration_created_idx
  ON private.decisions(integration_id, created_at DESC);

CREATE TABLE IF NOT EXISTS private.deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES private.decisions(id) ON DELETE RESTRICT,
  offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  delivery_nonce TEXT NOT NULL UNIQUE,
  delivery_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS deliveries_integration_created_idx
  ON private.deliveries(integration_id, created_at DESC);

CREATE TABLE IF NOT EXISTS private.clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES private.deliveries(id) ON DELETE RESTRICT,
  click_token_hash TEXT NOT NULL UNIQUE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  qualification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (qualification_status IN ('pending', 'qualified', 'not_qualified', 'rejected')),
  verification_result TEXT
);

CREATE INDEX IF NOT EXISTS clicks_delivery_id_idx
  ON private.clicks(delivery_id);

CREATE TABLE IF NOT EXISTS private.qualified_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id UUID NOT NULL REFERENCES private.clicks(id) ON DELETE RESTRICT,
  qualification_version TEXT NOT NULL,
  reason_code TEXT,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (click_id)
);

CREATE INDEX IF NOT EXISTS qualified_clicks_qualified_at_idx
  ON private.qualified_clicks(qualified_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Advertiser capacity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.advertiser_credit_accounts (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  granted_units INTEGER NOT NULL DEFAULT 0 CHECK (granted_units >= 0),
  consumed_units INTEGER NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
  available_units INTEGER NOT NULL DEFAULT 0 CHECK (available_units >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (available_units = granted_units - consumed_units)
);

CREATE TABLE IF NOT EXISTS private.advertiser_credit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('grant', 'consumption', 'adjustment')),
  units INTEGER NOT NULL CHECK (units > 0),
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS advertiser_credit_entries_workspace_created_idx
  ON private.advertiser_credit_entries(workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS advertiser_credit_consumption_reference_uq
  ON private.advertiser_credit_entries(workspace_id, entry_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. Financial accounting
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('workspace', 'platform')),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('advertiser_spend', 'publisher_earnings', 'platform_revenue')),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (
    (owner_type = 'workspace' AND workspace_id IS NOT NULL AND account_type IN ('advertiser_spend', 'publisher_earnings'))
    OR
    (owner_type = 'platform' AND workspace_id IS NULL AND account_type = 'platform_revenue')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_workspace_type_uq
  ON private.financial_accounts(workspace_id, account_type)
  WHERE workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_platform_type_uq
  ON private.financial_accounts(account_type)
  WHERE owner_type = 'platform';

CREATE INDEX IF NOT EXISTS financial_accounts_workspace_type_idx
  ON private.financial_accounts(workspace_id, account_type);

CREATE TABLE IF NOT EXISTS private.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualified_click_id UUID NOT NULL REFERENCES private.qualified_clicks(id) ON DELETE RESTRICT,
  advertiser_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  publisher_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  charge_cents INTEGER NOT NULL,
  publisher_share_cents INTEGER NOT NULL,
  platform_share_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  settled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (qualified_click_id),
  CHECK (charge_cents > 0),
  CHECK (publisher_share_cents >= 0),
  CHECK (platform_share_cents >= 0),
  CHECK (publisher_share_cents + platform_share_cents = charge_cents),
  CHECK (
    charge_cents = 100
    AND publisher_share_cents = 75
    AND platform_share_cents = 25
    AND currency = 'USD'
  )
);

CREATE INDEX IF NOT EXISTS settlements_advertiser_settled_idx
  ON private.settlements(advertiser_workspace_id, settled_at DESC);

CREATE INDEX IF NOT EXISTS settlements_publisher_settled_idx
  ON private.settlements(publisher_workspace_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS private.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES private.settlements(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES private.financial_accounts(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS financial_entries_settlement_idx
  ON private.financial_entries(settlement_id);

CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_settlement_account_type_uq
  ON private.financial_entries(settlement_id, account_id, entry_type);

-- ---------------------------------------------------------------------------
-- 9. Immutability for financial history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.prevent_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, private, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'immutable record cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_qualified_clicks_immutable
  ON private.qualified_clicks;

CREATE TRIGGER trg_qualified_clicks_immutable
BEFORE UPDATE OR DELETE ON private.qualified_clicks
FOR EACH ROW
EXECUTE FUNCTION private.prevent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_advertiser_credit_entries_immutable
  ON private.advertiser_credit_entries;

CREATE TRIGGER trg_advertiser_credit_entries_immutable
BEFORE UPDATE OR DELETE ON private.advertiser_credit_entries
FOR EACH ROW
EXECUTE FUNCTION private.prevent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_financial_entries_immutable
  ON private.financial_entries;

CREATE TRIGGER trg_financial_entries_immutable
BEFORE UPDATE OR DELETE ON private.financial_entries
FOR EACH ROW
EXECUTE FUNCTION private.prevent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_settlements_immutable
  ON private.settlements;

CREATE TRIGGER trg_settlements_immutable
BEFORE UPDATE OR DELETE ON private.settlements
FOR EACH ROW
EXECUTE FUNCTION private.prevent_immutable_mutation();

-- ---------------------------------------------------------------------------
-- 10. Public control-plane RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_moments ENABLE ROW LEVEL SECURITY;

-- Remove prototype policies.
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view products in their workspaces" ON public.products;
DROP POLICY IF EXISTS "Users can insert products in their workspaces" ON public.products;
DROP POLICY IF EXISTS "Users can view moments in their products" ON public.moments;
DROP POLICY IF EXISTS "Users can insert moments in their products" ON public.moments;
DROP POLICY IF EXISTS "Users can view their own offers" ON public.offers;
DROP POLICY IF EXISTS "Users can insert their own offers" ON public.offers;
DROP POLICY IF EXISTS "Users can update their own offers" ON public.offers;

-- Workspace policies.
CREATE POLICY workspace_select_member
ON public.workspaces
FOR SELECT
TO authenticated
USING ((SELECT private.current_workspace_role(id)) IS NOT NULL);

CREATE POLICY workspace_insert_self
ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY workspace_update_owner
ON public.workspaces
FOR UPDATE
TO authenticated
USING ((SELECT private.current_workspace_role(id)) = 'owner')
WITH CHECK (created_by = (SELECT auth.uid()));

-- Membership policies.
CREATE POLICY workspace_members_select_member
ON public.workspace_members
FOR SELECT
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

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
      WHERE w.id = workspace_id
        AND w.created_by = (SELECT auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_members AS existing_member
      WHERE existing_member.workspace_id = workspace_id
    )
  )
  OR
  (
    role = 'member'
    AND (SELECT private.current_workspace_role(workspace_id)) = 'owner'
  )
);

-- Capability policies.
CREATE POLICY workspace_capabilities_select_member
ON public.workspace_capabilities
FOR SELECT
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY workspace_capabilities_insert_member
ON public.workspace_capabilities
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY workspace_capabilities_update_member
ON public.workspace_capabilities
FOR UPDATE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL)
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY workspace_capabilities_delete_member
ON public.workspace_capabilities
FOR DELETE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

-- Product policies.
CREATE POLICY products_select_member
ON public.products
FOR SELECT
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY products_insert_member
ON public.products
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY products_update_member
ON public.products
FOR UPDATE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL)
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY products_delete_member
ON public.products
FOR DELETE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

-- Moment policies.
CREATE POLICY moments_select_member
ON public.moments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY moments_insert_member
ON public.moments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY moments_update_member
ON public.moments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY moments_delete_member
ON public.moments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

-- Integration policies.
CREATE POLICY integrations_select_member
ON public.integrations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY integrations_insert_member
ON public.integrations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY integrations_update_member
ON public.integrations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY integrations_delete_member
ON public.integrations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

-- Offer policies.
CREATE POLICY offers_select_member
ON public.offers
FOR SELECT
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY offers_insert_member
ON public.offers
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY offers_update_member
ON public.offers
FOR UPDATE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL)
WITH CHECK ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

CREATE POLICY offers_delete_member
ON public.offers
FOR DELETE
TO authenticated
USING ((SELECT private.current_workspace_role(workspace_id)) IS NOT NULL);

-- Relational Offer-to-Moment targeting.
CREATE POLICY offer_moments_select_member
ON public.offer_moments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.offers AS o
    WHERE o.id = offer_id
      AND (SELECT private.current_workspace_role(o.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY offer_moments_insert_member
ON public.offer_moments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.offers AS o
    WHERE o.id = offer_id
      AND (SELECT private.current_workspace_role(o.workspace_id)) IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.moments AS m
    JOIN public.products AS p ON p.id = m.product_id
    WHERE m.id = moment_id
      AND (SELECT private.current_workspace_role(p.workspace_id)) IS NOT NULL
  )
);

CREATE POLICY offer_moments_delete_member
ON public.offer_moments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.offers AS o
    WHERE o.id = offer_id
      AND (SELECT private.current_workspace_role(o.workspace_id)) IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 11. Least-privilege grants
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
FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
  ON public.workspaces TO authenticated;

GRANT SELECT, INSERT
  ON public.workspace_members TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.workspace_capabilities TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.products TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.moments TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.integrations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.offers TO authenticated;

GRANT SELECT, INSERT, DELETE
  ON public.offer_moments TO authenticated;

GRANT ALL PRIVILEGES
  ON public.workspaces,
     public.workspace_members,
     public.workspace_capabilities,
     public.products,
     public.moments,
     public.integrations,
     public.offers,
     public.offer_moments
TO service_role;

REVOKE ALL ON TABLE
  private.integration_secrets,
  private.events,
  private.moment_occurrences,
  private.decisions,
  private.deliveries,
  private.clicks,
  private.qualified_clicks,
  private.advertiser_credit_accounts,
  private.advertiser_credit_entries,
  private.financial_accounts,
  private.financial_entries,
  private.settlements
FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA private TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA private TO service_role;

REVOKE USAGE ON SCHEMA private FROM anon, authenticated;

COMMIT;
