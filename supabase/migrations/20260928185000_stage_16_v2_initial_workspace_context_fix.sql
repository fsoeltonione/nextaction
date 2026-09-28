-- Stage 16 runtime fix: preserve the first-workspace NULL context.
--
-- The v2 confirmation wrapper accepts NULL workspace_id only when the
-- authenticated user has zero workspace memberships. In that case the
-- underlying legacy-compatible RPC creates the initial workspace atomically.
-- Existing workspace-scoped confirmations remain explicit.
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
  IF p_workspace_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.confirm_product_activation(
      p_canonical_url,
      p_domain,
      p_name,
      p_description,
      p_moments
    );
    RETURN;
  END IF;

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

COMMIT;
