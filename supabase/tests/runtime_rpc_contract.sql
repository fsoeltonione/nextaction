BEGIN;
SELECT plan(78);

WITH rpc(signature) AS (
  VALUES
    ('public.check_runtime_rate_limit(text,text,integer,integer)'),
    ('public.resolve_runtime_integration(text)'),
    ('public.runtime_accept_event(uuid,text,text,timestamptz,jsonb,uuid)'),
    ('public.runtime_process_event(uuid)'),
    ('public.runtime_create_decision_delivery(uuid,text,uuid,text,text,timestamptz)'),
    ('public.runtime_worker_tick(integer,integer)'),
    ('public.runtime_record_click(text)'),
    ('public.runtime_record_and_qualify_click(text)'),
    ('public.runtime_settle_qualified_click(uuid)'),
    ('public.runtime_click_qualify_and_settle(text)'),
    ('public.runtime_get_workspace_balance(uuid)'),
    ('public.runtime_operations_tick(integer,integer,integer)'),
    ('private.reconcile_unsettled_qualified_clicks(integer)')
),
checks AS (
  SELECT
    'RPC exists: ' || signature AS description,
    to_regprocedure(signature) IS NOT NULL AS passed
  FROM rpc

  UNION ALL

  SELECT
    'RPC is SECURITY DEFINER: ' || signature,
    COALESCE((
      SELECT p.prosecdef
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid = to_regprocedure(signature)
    ), FALSE)
  FROM rpc

  UNION ALL

  SELECT
    'RPC pins search_path: ' || signature,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS p
      CROSS JOIN LATERAL unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg(setting)
      WHERE p.oid = to_regprocedure(signature)
        AND cfg.setting LIKE 'search_path=%'
    )
  FROM rpc

  UNION ALL

  SELECT
    'RPC denies anon EXECUTE: ' || signature,
    to_regprocedure(signature) IS NOT NULL
      AND NOT has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
  FROM rpc

  UNION ALL

  SELECT
    'RPC denies authenticated EXECUTE: ' || signature,
    to_regprocedure(signature) IS NOT NULL
      AND NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
  FROM rpc

  UNION ALL

  SELECT
    'RPC grants service_role EXECUTE: ' || signature,
    to_regprocedure(signature) IS NOT NULL
      AND has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE')
  FROM rpc
)
SELECT ok(passed, description)
FROM checks
ORDER BY description;

SELECT * FROM finish();
ROLLBACK;
