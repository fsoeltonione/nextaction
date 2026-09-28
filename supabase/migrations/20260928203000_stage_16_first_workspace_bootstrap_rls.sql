-- Stage 16 follow-up: permit the authenticated creator to see a workspace
-- during the atomic first-workspace bootstrap transaction.
--
-- The existing workspace_members_insert policy validates that the workspace
-- was created by the authenticated user. With the previous SELECT policy,
-- that validation could not observe the freshly inserted workspace because
-- visibility required an existing membership. The two policies therefore
-- deadlocked the zero-membership activation path.
BEGIN;

DROP POLICY IF EXISTS workspace_select_member ON public.workspaces;

CREATE POLICY workspace_select_member
ON public.workspaces
FOR SELECT
TO authenticated
USING (
  (SELECT private.current_workspace_role(workspaces.id)) IS NOT NULL
  OR workspaces.created_by = (SELECT auth.uid())
);

COMMIT;
