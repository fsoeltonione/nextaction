CREATE OR REPLACE FUNCTION public.runtime_record_click(
  p_delivery_token_hash TEXT
)
RETURNS TABLE (
  result_outcome TEXT,
  result_click_id UUID,
  result_qualification_status TEXT,
  result_destination_url TEXT,
  result_reason_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_destination_url TEXT;
  v_click_id UUID;
  v_qualification_status TEXT;
BEGIN
  IF p_delivery_token_hash IS NULL
     OR p_delivery_token_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid delivery token hash'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    d.id,
    d.expires_at,
    o.destination_url
  INTO
    v_delivery_id,
    v_expires_at,
    v_destination_url
  FROM private.deliveries AS d
  JOIN public.offers AS o
    ON o.id = d.offer_id
  WHERE d.delivery_token_hash = p_delivery_token_hash
  LIMIT 1;

  IF v_delivery_id IS NULL THEN
    RETURN QUERY
    SELECT
      'not_found'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      'delivery_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_expires_at IS NOT NULL
     AND v_expires_at <= pg_catalog.clock_timestamp()
  THEN
    RETURN QUERY
    SELECT
      'expired'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      'delivery_expired'::TEXT;
    RETURN;
  END IF;

  IF v_destination_url IS NULL
     OR v_destination_url !~* '^https?://'
  THEN
    RETURN QUERY
    SELECT
      'destination_unavailable'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      'destination_unavailable'::TEXT;
    RETURN;
  END IF;

  SELECT
    c.id,
    c.qualification_status
  INTO
    v_click_id,
    v_qualification_status
  FROM private.clicks AS c
  WHERE c.click_token_hash = p_delivery_token_hash
  LIMIT 1;

  IF v_click_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'replayed'::TEXT,
      v_click_id,
      v_qualification_status,
      v_destination_url,
      NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO private.clicks (
    delivery_id,
    click_token_hash,
    qualification_status,
    verification_result
  )
  VALUES (
    v_delivery_id,
    p_delivery_token_hash,
    'pending',
    NULL
  )
  ON CONFLICT (click_token_hash)
  DO NOTHING
  RETURNING id, qualification_status
  INTO v_click_id, v_qualification_status;

  IF v_click_id IS NULL THEN
    SELECT
      c.id,
      c.qualification_status
    INTO
      v_click_id,
      v_qualification_status
    FROM private.clicks AS c
    WHERE c.click_token_hash = p_delivery_token_hash
    LIMIT 1;

    RETURN QUERY
    SELECT
      'replayed'::TEXT,
      v_click_id,
      v_qualification_status,
      v_destination_url,
      NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'created'::TEXT,
    v_click_id,
    v_qualification_status,
    v_destination_url,
    NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_record_click(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.runtime_record_click(TEXT)
  TO service_role;
