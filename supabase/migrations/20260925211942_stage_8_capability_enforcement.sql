-- NextAction Stage 8 capability enforcement
-- Reach Customers offer creation is only valid after the workspace selects it.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_offer_activation(
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_moment_ids UUID[]
)
RETURNS TABLE (result_workspace_id UUID, result_offer_id UUID, result_moment_count INTEGER)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_offer_id UUID;
  v_moment_count INTEGER;
  v_input_count INTEGER;
  v_target_keys TEXT[];
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_title IS NULL OR length(trim(p_title))<1 OR length(p_title)>160
    THEN RAISE EXCEPTION 'invalid offer title' USING ERRCODE='22023'; END IF;
  IF p_description IS NOT NULL AND length(p_description)>2000
    THEN RAISE EXCEPTION 'offer description is too long' USING ERRCODE='22023'; END IF;
  IF p_cta_label IS NULL OR length(trim(p_cta_label))<1 OR length(p_cta_label)>80
    THEN RAISE EXCEPTION 'invalid call to action label' USING ERRCODE='22023'; END IF;
  IF p_destination_url IS NULL OR length(trim(p_destination_url))>2048
     OR p_destination_url !~* '^https?://[^/?#]+(?:/[^?#]*)?$' OR p_destination_url~'[?#]'
    THEN RAISE EXCEPTION 'invalid destination URL' USING ERRCODE='22023'; END IF;
  IF p_moment_ids IS NULL OR cardinality(p_moment_ids)<1 OR cardinality(p_moment_ids)>20
    THEN RAISE EXCEPTION 'one to twenty target moments are required' USING ERRCODE='22023'; END IF;

  v_input_count:=cardinality(p_moment_ids);

  IF (SELECT count(DISTINCT x) FROM unnest(p_moment_ids) AS t(x))<>v_input_count
    THEN RAISE EXCEPTION 'duplicate target moment is not allowed' USING ERRCODE='23505'; END IF;

  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members AS wm
  WHERE wm.user_id=v_user_id
  ORDER BY (wm.role='owner') DESC,wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id=v_workspace_id
      AND wc.capability='reach_customers'
      AND wc.status='active'
  ) THEN
    RAISE EXCEPTION 'reach_customers capability is not active' USING ERRCODE='42501';
  END IF;

  SELECT count(*),array_agg(m.moment_key ORDER BY m.moment_key)
  INTO v_moment_count,v_target_keys
  FROM public.moments AS m
  JOIN public.products AS p ON p.id=m.product_id
  WHERE m.id=ANY(p_moment_ids)
    AND p.workspace_id=v_workspace_id
    AND m.status='active';

  IF v_moment_count<>v_input_count THEN
    RAISE EXCEPTION 'one or more target moments are not in the current workspace' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.offers AS o(
    workspace_id,title,description,cta_label,cta_url,target_moments,status,destination_url,updated_at
  )
  VALUES(
    v_workspace_id,trim(p_title),NULLIF(trim(p_description),''),
    trim(p_cta_label),p_destination_url,v_target_keys,'active',p_destination_url,
    timezone('utc'::text,now())
  )
  RETURNING o.id INTO v_offer_id;

  INSERT INTO public.offer_moments(offer_id,moment_id)
  SELECT v_offer_id,ids.x FROM unnest(p_moment_ids) AS ids(x);

  RETURN QUERY SELECT v_workspace_id,v_offer_id,v_moment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) TO authenticated;

COMMIT;