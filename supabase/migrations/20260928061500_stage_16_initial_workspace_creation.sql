-- Stage 16 follow-up: allow the first authenticated Product confirmation
-- to create the initial workspace when the user has zero memberships.
--
-- Existing workspace-scoped activations remain explicit. A NULL workspace
-- context is valid only for the zero-membership first-confirmation case.
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
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_membership_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_membership_count
  FROM public.workspace_members
  WHERE user_id = v_user_id;

  IF p_workspace_id IS NULL THEN
    IF v_membership_count > 0 THEN
      RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
    END IF;
    -- The underlying activation function owns the atomic initial workspace
    -- creation and Product/Moment persistence.
    RETURN QUERY SELECT * FROM public.confirm_product_activation(
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
    FROM public.workspace_members
    WHERE user_id = v_user_id
      AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY SELECT * FROM public.confirm_product_activation(
    p_canonical_url,
    p_domain,
    p_name,
    p_description,
    p_moments
  );
END;
$$;

COMMIT;
