-- Stage 16 follow-up: repair first-workspace bootstrap under RLS.
--
-- The initial-workspace activation RPC creates a workspace and then creates
-- its owner membership in the same transaction. The membership INSERT policy
-- previously checked the workspace through a normal RLS-filtered SELECT.
-- At that point the user was not yet a member, so the policy could not see
-- the just-created workspace and rejected the owner membership.
--
-- Keep workspace visibility membership-scoped. Use a narrowly scoped
-- SECURITY DEFINER provenance helper only for the owner bootstrap check.
BEGIN;

CREATE OR REPLACE FUNCTION private.is_current_user_workspace_creator(
  p_workspace_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces AS w
    WHERE w.id = p_workspace_id
      AND w.created_by = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION private.is_current_user_workspace_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_current_user_workspace_creator(UUID) TO authenticated;

DROP POLICY IF EXISTS workspace_members_insert ON public.workspace_members;

CREATE POLICY workspace_members_insert
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  (
    user_id = (SELECT auth.uid())
    AND role = 'owner'
    AND private.is_current_user_workspace_creator(workspace_id)
  )
  OR
  (
    role = 'member'
    AND (SELECT private.current_workspace_role(workspace_id)) = 'owner'
  )
);

COMMIT;
