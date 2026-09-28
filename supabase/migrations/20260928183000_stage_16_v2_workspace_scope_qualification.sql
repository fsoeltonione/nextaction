-- Stage 16 runtime fix: qualify workspace_members workspace_id references
-- inside v2 SECURITY INVOKER wrappers.
--
-- The RETURNS TABLE output column named workspace_id is a PL/pgSQL variable.
-- Unqualified workspace_id references inside the wrapper therefore become
-- ambiguous. Qualify all workspace membership predicates explicitly.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_product_activation_v2(
  p_workspace_id UUID,
  p_canonical_url TEXT,
  p_domain TEXT,
  p_name TEXT,
  p_description TEXT,
  p_moments JSONB
)
RETURNS TABLE (workspace_id UUID, product_id UUID, moment_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY
  SELECT *
  FROM public.confirm_product_activation(
    p_canonical_url,
    p_domain,
    p_name,
    p_description,
    p_moments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_capabilities_v2(
  p_workspace_id UUID,
  p_capabilities TEXT[]
)
RETURNS TABLE (workspace_id UUID, capability TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY
  SELECT *
  FROM public.set_workspace_capabilities(p_capabilities);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_offer_activation_v2(
  p_workspace_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_moment_ids UUID[]
)
RETURNS TABLE (workspace_id UUID, offer_id UUID, moment_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities wc
    WHERE wc.workspace_id = p_workspace_id
      AND wc.capability = 'reach_customers'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'reach customers capability not selected' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY
  SELECT *
  FROM public.create_offer_activation(
    p_title,
    p_description,
    p_cta_label,
    p_destination_url,
    p_moment_ids
  );
END;
$$;

COMMIT;
