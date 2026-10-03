-- H3.1 follow-up: classify unknown/inactive Network Moment targets as
-- invalid input rather than workspace authorization failures.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_network_offer_activation_v1(
  p_workspace_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_network_moment_keys TEXT[]
)
RETURNS TABLE (
  workspace_id UUID,
  offer_id UUID,
  network_moment_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_offer_id UUID;
  v_target_count INTEGER;
  v_input_count INTEGER;
  v_network_keys TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members AS wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id = p_workspace_id
      AND wc.capability = 'reach_customers'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'reach customers capability not selected' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR length(btrim(p_title)) < 1 OR length(p_title) > 160 THEN
    RAISE EXCEPTION 'invalid offer title' USING ERRCODE = '22023';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'offer description is too long' USING ERRCODE = '22023';
  END IF;

  IF p_cta_label IS NULL OR length(btrim(p_cta_label)) < 1 OR length(p_cta_label) > 80 THEN
    RAISE EXCEPTION 'invalid call to action label' USING ERRCODE = '22023';
  END IF;

  IF p_destination_url IS NULL
     OR length(btrim(p_destination_url)) > 2048
     OR p_destination_url !~* '^https?://[^/?#]+(?:/[^?#]*)?$'
     OR p_destination_url ~ '[?#]'
  THEN
    RAISE EXCEPTION 'invalid destination URL' USING ERRCODE = '22023';
  END IF;

  IF p_network_moment_keys IS NULL
     OR cardinality(p_network_moment_keys) < 1
     OR cardinality(p_network_moment_keys) > 20
  THEN
    RAISE EXCEPTION 'one to twenty target network moments are required' USING ERRCODE = '22023';
  END IF;

  v_network_keys := ARRAY(
    SELECT lower(btrim(key))
    FROM unnest(p_network_moment_keys) AS input_keys(key)
  );

  v_input_count := cardinality(v_network_keys);

  IF EXISTS (
    SELECT 1
    FROM unnest(v_network_keys) AS input_keys(key)
    WHERE key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
       OR length(key) > 100
  ) THEN
    RAISE EXCEPTION 'invalid target network moment key' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(DISTINCT key)
    FROM unnest(v_network_keys) AS input_keys(key)
  ) <> v_input_count THEN
    RAISE EXCEPTION 'duplicate target network moment is not allowed' USING ERRCODE = '23505';
  END IF;

  SELECT count(*)
  INTO v_target_count
  FROM public.network_moments AS nm
  WHERE nm.key = ANY(v_network_keys)
    AND nm.status = 'active';

  IF v_target_count <> v_input_count THEN
    RAISE EXCEPTION 'one or more target network moments are not available' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.offers (
    workspace_id,
    title,
    description,
    cta_label,
    cta_url,
    target_moments,
    status,
    destination_url,
    updated_at
  )
  VALUES (
    p_workspace_id,
    btrim(p_title),
    NULLIF(btrim(p_description), ''),
    btrim(p_cta_label),
    p_destination_url,
    ARRAY[]::TEXT[],
    'active',
    p_destination_url,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.offer_network_moments (offer_id, network_moment_id)
  SELECT
    v_offer_id,
    nm.id
  FROM public.network_moments AS nm
  WHERE nm.key = ANY(v_network_keys)
    AND nm.status = 'active';

  RETURN QUERY
  SELECT p_workspace_id, v_offer_id, v_input_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_network_offer_activation_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_network_offer_activation_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated;

COMMIT;
