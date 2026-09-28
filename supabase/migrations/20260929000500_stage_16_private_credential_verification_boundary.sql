-- NextAction Stage 16: private credential verification boundary.
-- Resolve credential hashes through a service-role-only SECURITY DEFINER RPC so
-- the HTTP route never depends on PostgREST exposure of the private schema.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_integration_credential_v2(
  p_credential_hash TEXT
)
RETURNS TABLE (result_integration_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF p_credential_hash IS NULL
     OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid credential hash' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT i.id
  FROM private.integration_secrets AS s
  JOIN public.integrations AS i
    ON i.id = s.integration_id
  WHERE s.credential_hash = p_credential_hash
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_integration_credential_v2(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_integration_credential_v2(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_integration_credential_v2(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_integration_credential_v2(TEXT) TO service_role;

COMMIT;
