-- Reconcile the live pgmq schema privilege with the least-privilege staging baseline.
-- Runtime application entrypoints call PGMQ only from SECURITY DEFINER RPCs
-- with a pinned search_path; service_role does not need direct schema USAGE.
BEGIN;

REVOKE USAGE ON SCHEMA pgmq FROM service_role;

COMMIT;
