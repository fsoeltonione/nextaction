-- H4.4: remove the non-unique financial account lookup index.
-- The validated table CHECK constraint makes workspace_id non-NULL equivalent
-- to owner_type='workspace'. The retained unique partial index on
-- `financial_accounts_workspace_type_uq` on (workspace_id, account_type) WHERE workspace_id IS NOT NULL serves workspace
-- equality lookups and the workspace_id FK checks; production EXPLAIN confirms
-- that plan. The narrower duplicate index had zero scans in prod and staging.

BEGIN;
DROP INDEX IF EXISTS private.financial_accounts_workspace_type_idx;
COMMIT;
