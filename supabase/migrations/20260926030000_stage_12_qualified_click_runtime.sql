CREATE OR REPLACE FUNCTION public.runtime_record_and_qualify_click(
  p_delivery_token_hash TEXT
)
RETURNS TABLE (
  result_outcome TEXT,
  result_click_id UUID,
  result_qualification_status TEXT,
  result_destination_url TEXT,
  result_reason_code TEXT,
  result_qualified_click_id UUID,
  result_qualification_version TEXT,
  result_qualified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_click_id UUID;
  v_qualification_status TEXT;
  v_destination_url TEXT;
  v_outcome TEXT;
  v_reason_code TEXT;
  v_qualified_click_id UUID;
  v_qualification_version TEXT;
  v_qualified_at TIMESTAMPTZ;
BEGIN
  -- qv1 is intentionally code-controlled. The client never supplies
  -- qualification policy version or business evidence.
  v_qualification_version := 'qv1';
  v_reason_code := 'qv1_valid_first_delivery_click';

  SELECT
    r.result_outcome,
    r.result_click_id,
    r.result_qualification_status,
    r.result_destination_url,
    r.result_reason_code
  INTO
    v_outcome,
    v_click_id,
    v_qualification_status,
    v_destination_url,
    v_reason_code
  FROM public.runtime_record_click(p_delivery_token_hash) AS r
  LIMIT 1;

  IF v_click_id IS NULL
     OR v_outcome NOT IN ('created', 'replayed')
  THEN
    RETURN QUERY
    SELECT
      v_outcome,
      v_click_id,
      v_qualification_status,
      v_destination_url,
      v_reason_code,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_qualification_status = 'pending' THEN
    INSERT INTO private.qualified_clicks (
      click_id,
      qualification_version,
      reason_code
    )
    VALUES (
      v_click_id,
      v_qualification_version,
      v_reason_code
    )
    ON CONFLICT (click_id)
    DO NOTHING
    RETURNING
      id,
      qualification_version,
      reason_code,
      qualified_at
    INTO
      v_qualified_click_id,
      v_qualification_version,
      v_reason_code,
      v_qualified_at;

    IF v_qualified_click_id IS NULL THEN
      SELECT
        qc.id,
        qc.qualification_version,
        qc.reason_code,
        qc.qualified_at
      INTO
        v_qualified_click_id,
        v_qualification_version,
        v_reason_code,
        v_qualified_at
      FROM private.qualified_clicks AS qc
      WHERE qc.click_id = v_click_id
      LIMIT 1;
    END IF;

    UPDATE private.clicks AS c
    SET qualification_status = 'qualified'
    WHERE c.id = v_click_id
      AND c.qualification_status = 'pending';

    SELECT c.qualification_status
    INTO v_qualification_status
    FROM private.clicks AS c
    WHERE c.id = v_click_id
    LIMIT 1;
  ELSE
    SELECT
      qc.id,
      qc.qualification_version,
      qc.reason_code,
      qc.qualified_at
    INTO
      v_qualified_click_id,
      v_qualification_version,
      v_reason_code,
      v_qualified_at
    FROM private.qualified_clicks AS qc
    WHERE qc.click_id = v_click_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    v_outcome,
    v_click_id,
    v_qualification_status,
    v_destination_url,
    CASE
      WHEN v_qualification_status = 'qualified'
        THEN v_reason_code
      ELSE NULL::TEXT
    END,
    v_qualified_click_id,
    CASE
      WHEN v_qualification_status = 'qualified'
        THEN v_qualification_version
      ELSE NULL::TEXT
    END,
    CASE
      WHEN v_qualification_status = 'qualified'
        THEN v_qualified_at
      ELSE NULL::TIMESTAMPTZ
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_record_and_qualify_click(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.runtime_record_and_qualify_click(TEXT)
  TO service_role;
