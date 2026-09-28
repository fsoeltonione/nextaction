-- NextAction Stage 16: atomic integration credential provisioning.
-- Keep private.integration_secrets private while making the server-side
-- provisioning operation atomic and callable only with the service role.
BEGIN;

CREATE OR REPLACE FUNCTION public.provision_integration_credential_v2(
  p_product_id UUID,
  p_credential_hash TEXT
)
RETURNS TABLE (result_integration_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_integration_id UUID;
  v_last_seen_at TIMESTAMPTZ;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product id is required' USING ERRCODE = '22023';
  END IF;

  IF p_credential_hash IS NULL
     OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid credential hash' USING ERRCODE = '22023';
  END IF;

  -- Serialize provisioning for the same product so concurrent first-clicks
  -- cannot create duplicate integrations or overwrite one another midway.
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  SELECT i.id, i.last_seen_at
  INTO v_integration_id, v_last_seen_at
  FROM public.integrations AS i
  WHERE i.product_id = p_product_id
    AND i.name = 'NextAction Runtime'
  FOR UPDATE;

  IF v_integration_id IS NOT NULL AND v_last_seen_at IS NOT NULL THEN
    RAISE EXCEPTION 'integration already verified'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_integration_id IS NULL THEN
    INSERT INTO public.integrations (
      product_id,
      name,
      status,
      last_seen_at,
      revoked_at
    )
    VALUES (
      p_product_id,
      'NextAction Runtime',
      'active',
      NULL,
      NULL
    )
    RETURNING id INTO v_integration_id;
  ELSE
    UPDATE public.integrations
    SET status = 'active',
        last_seen_at = NULL,
        revoked_at = NULL
    WHERE id = v_integration_id;
  END IF;

  INSERT INTO private.integration_secrets (
    integration_id,
    credential_hash,
    rotated_at
  )
  VALUES (
    v_integration_id,
    p_credential_hash,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (integration_id)
  DO UPDATE SET
    credential_hash = EXCLUDED.credential_hash,
    rotated_at = EXCLUDED.rotated_at;

  RETURN QUERY SELECT v_integration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_integration_credential_v2(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_integration_credential_v2(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.provision_integration_credential_v2(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_integration_credential_v2(UUID, TEXT) TO service_role;

COMMIT;
