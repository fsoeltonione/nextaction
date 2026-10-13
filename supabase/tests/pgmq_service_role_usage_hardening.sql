BEGIN;

SELECT plan(4);

SELECT ok(
  NOT has_schema_privilege('service_role', 'pgmq', 'USAGE'),
  'service_role cannot use the pgmq schema directly'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = 'public.runtime_readiness()'::regprocedure
      AND p.prosecdef
  ),
  'runtime_readiness remains SECURITY DEFINER'
);

SELECT ok(
  has_function_privilege('service_role', 'public.runtime_readiness()', 'EXECUTE'),
  'service_role can invoke the runtime_readiness RPC'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS cfg(setting)
    WHERE p.oid = 'public.runtime_readiness()'::regprocedure
      AND cfg.setting = 'search_path=""'
  ),
  'runtime_readiness pins an empty search_path'
);

-- Exercise the real RPC as service_role after removing direct pgmq USAGE.
-- The SECURITY DEFINER function performs the privileged queue/catalog reads.
SET LOCAL ROLE service_role;
DO $runtime_readiness$
BEGIN
  IF public.runtime_readiness() IS NULL THEN
    RAISE EXCEPTION 'runtime_readiness returned NULL after pgmq schema hardening';
  END IF;
END;
$runtime_readiness$;
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
