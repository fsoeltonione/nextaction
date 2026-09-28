-- NextAction Stage 16: explicit activation workspace context.
--
-- The original Stage 8 RPCs selected the first membership. Stage 16 keeps the
-- original signatures for compatibility, but removes silent multi-workspace
-- fallback and adds explicit-context wrappers used by the application.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_product_activation(
  p_canonical_url TEXT,
  p_domain TEXT,
  p_name TEXT,
  p_description TEXT,
  p_moments JSONB
)
RETURNS TABLE (result_workspace_id UUID, result_product_id UUID, result_moment_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_requested_workspace_id UUID;
  v_product_id UUID;
  v_moment_count INTEGER;
  v_input_count INTEGER;
  v_membership_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  IF p_canonical_url IS NULL OR length(trim(p_canonical_url)) > 2048
     OR p_canonical_url !~* '^https?://[^/?#]+(?:/[^?#]*)?$' OR p_canonical_url ~ '[?#]' THEN
    RAISE EXCEPTION 'invalid canonical product URL' USING ERRCODE = '22023';
  END IF;
  IF p_domain IS NULL OR length(trim(p_domain)) = 0 OR length(trim(p_domain)) > 255 THEN
    RAISE EXCEPTION 'invalid product domain' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 1 OR length(trim(p_name)) > 160 THEN
    RAISE EXCEPTION 'invalid product name' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'product description is too long' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_moments) <> 'array' THEN
    RAISE EXCEPTION 'moments must be an array' USING ERRCODE = '22023';
  END IF;

  v_input_count := jsonb_array_length(p_moments);
  IF v_input_count < 1 OR v_input_count > 20 THEN
    RAISE EXCEPTION 'between 1 and 20 moments are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_moments) AS r(key TEXT, label TEXT, description TEXT)
    WHERE r.key IS NULL OR r.key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' OR length(r.key) > 100
      OR r.label IS NULL OR length(trim(r.label)) < 1 OR length(r.label) > 160
      OR (r.description IS NOT NULL AND length(r.description) > 1000)
  ) THEN
    RAISE EXCEPTION 'invalid moment definition' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT r.key) FROM jsonb_to_recordset(p_moments) AS r(key TEXT, label TEXT, description TEXT)) <> v_input_count THEN
    RAISE EXCEPTION 'duplicate moment keys are not allowed' USING ERRCODE = '23505';
  END IF;

  v_requested_workspace_id := nullif(current_setting('nextaction.workspace_id', true), '')::UUID;
  SELECT count(*) INTO v_membership_count FROM public.workspace_members wm WHERE wm.user_id = v_user_id;

  IF v_requested_workspace_id IS NOT NULL THEN
    SELECT wm.workspace_id INTO v_workspace_id
    FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id AND wm.workspace_id = v_requested_workspace_id;
    IF v_workspace_id IS NULL THEN
      RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF v_membership_count > 1 THEN
    RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
  ELSE
    SELECT wm.workspace_id INTO v_workspace_id
    FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id
    ORDER BY (wm.role = 'owner') DESC, wm.created_at ASC LIMIT 1;
  END IF;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, user_id, created_by)
    VALUES ('My Workspace', v_user_id, v_user_id) RETURNING id INTO v_workspace_id;
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user_id, 'owner');
  END IF;

  INSERT INTO public.products (workspace_id, domain, name, description, canonical_url, understanding_status, updated_at)
  VALUES (v_workspace_id, lower(trim(p_domain)), trim(p_name), NULLIF(trim(p_description), ''), p_canonical_url, 'confirmed', timezone('utc'::text, now()))
  ON CONFLICT (workspace_id, canonical_url) DO UPDATE SET
    domain = EXCLUDED.domain, name = EXCLUDED.name, description = EXCLUDED.description,
    understanding_status = 'confirmed', updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_product_id;

  UPDATE public.moments m
  SET status = 'disabled', updated_at = timezone('utc'::text, now())
  WHERE m.product_id = v_product_id AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_moments) AS r(key TEXT, label TEXT, description TEXT) WHERE r.key = m.moment_key
  );

  INSERT INTO public.moments (product_id, moment_key, label, description, status, updated_at)
  SELECT v_product_id, r.key, trim(r.label), NULLIF(trim(r.description), ''), 'active', timezone('utc'::text, now())
  FROM jsonb_to_recordset(p_moments) AS r(key TEXT, label TEXT, description TEXT)
  ON CONFLICT (product_id, moment_key) DO UPDATE SET
    label = EXCLUDED.label, description = EXCLUDED.description, status = 'active', updated_at = timezone('utc'::text, now());

  SELECT count(*) INTO v_moment_count FROM public.moments WHERE product_id = v_product_id AND status = 'active';
  RETURN QUERY SELECT v_workspace_id, v_product_id, v_moment_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_capabilities(
  p_capabilities TEXT[]
)
RETURNS TABLE (result_workspace_id UUID, result_capability TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_requested_workspace_id UUID;
  v_membership_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_capabilities IS NULL OR cardinality(p_capabilities) < 1 OR cardinality(p_capabilities) > 2 THEN
    RAISE EXCEPTION 'one or two capabilities are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_capabilities) c(capability) WHERE c.capability NOT IN ('make_money', 'reach_customers')) THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT c.capability) FROM unnest(p_capabilities) c(capability)) <> cardinality(p_capabilities) THEN
    RAISE EXCEPTION 'duplicate capability is not allowed' USING ERRCODE = '23505';
  END IF;

  v_requested_workspace_id := nullif(current_setting('nextaction.workspace_id', true), '')::UUID;
  SELECT count(*) INTO v_membership_count FROM public.workspace_members wm WHERE wm.user_id = v_user_id;
  IF v_requested_workspace_id IS NOT NULL THEN
    SELECT wm.workspace_id INTO v_workspace_id FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id AND wm.workspace_id = v_requested_workspace_id;
    IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501'; END IF;
  ELSIF v_membership_count > 1 THEN
    RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
  ELSE
    SELECT wm.workspace_id INTO v_workspace_id FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id ORDER BY (wm.role = 'owner') DESC, wm.created_at ASC LIMIT 1;
  END IF;
  IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;

  DELETE FROM public.workspace_capabilities WHERE workspace_id = v_workspace_id AND capability <> ALL (p_capabilities);
  INSERT INTO public.workspace_capabilities (workspace_id, capability, status, updated_at)
  SELECT v_workspace_id, c.capability, 'active', timezone('utc'::text, now()) FROM unnest(p_capabilities) c(capability)
  ON CONFLICT (workspace_id, capability) DO UPDATE SET status = 'active', updated_at = timezone('utc'::text, now());

  RETURN QUERY SELECT wc.workspace_id, wc.capability FROM public.workspace_capabilities wc
  WHERE wc.workspace_id = v_workspace_id AND wc.status = 'active' ORDER BY wc.capability;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_offer_activation(
  p_title TEXT, p_description TEXT, p_cta_label TEXT, p_destination_url TEXT, p_moment_ids UUID[]
)
RETURNS TABLE (result_workspace_id UUID, result_offer_id UUID, result_moment_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_requested_workspace_id UUID;
  v_offer_id UUID;
  v_moment_count INTEGER;
  v_input_count INTEGER;
  v_target_keys TEXT[];
  v_membership_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) < 1 OR length(p_title) > 160 THEN RAISE EXCEPTION 'invalid offer title' USING ERRCODE = '22023'; END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN RAISE EXCEPTION 'offer description is too long' USING ERRCODE = '22023'; END IF;
  IF p_cta_label IS NULL OR length(trim(p_cta_label)) < 1 OR length(p_cta_label) > 80 THEN RAISE EXCEPTION 'invalid call to action label' USING ERRCODE = '22023'; END IF;
  IF p_destination_url IS NULL OR length(trim(p_destination_url)) > 2048 OR p_destination_url !~* '^https?://[^/?#]+(?:/[^?#]*)?$' OR p_destination_url ~ '[?#]' THEN RAISE EXCEPTION 'invalid destination URL' USING ERRCODE = '22023'; END IF;
  IF p_moment_ids IS NULL OR cardinality(p_moment_ids) < 1 OR cardinality(p_moment_ids) > 20 THEN RAISE EXCEPTION 'one to twenty target moments are required' USING ERRCODE = '22023'; END IF;
  v_input_count := cardinality(p_moment_ids);
  IF (SELECT count(DISTINCT x) FROM unnest(p_moment_ids) t(x)) <> v_input_count THEN RAISE EXCEPTION 'duplicate target moment is not allowed' USING ERRCODE = '23505'; END IF;

  v_requested_workspace_id := nullif(current_setting('nextaction.workspace_id', true), '')::UUID;
  SELECT count(*) INTO v_membership_count FROM public.workspace_members wm WHERE wm.user_id = v_user_id;
  IF v_requested_workspace_id IS NOT NULL THEN
    SELECT wm.workspace_id INTO v_workspace_id FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id AND wm.workspace_id = v_requested_workspace_id;
    IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501'; END IF;
  ELSIF v_membership_count > 1 THEN
    RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
  ELSE
    SELECT wm.workspace_id INTO v_workspace_id FROM public.workspace_members wm
    WHERE wm.user_id = v_user_id ORDER BY (wm.role = 'owner') DESC, wm.created_at ASC LIMIT 1;
  END IF;
  IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities wc
    WHERE wc.workspace_id = v_workspace_id
      AND wc.capability = 'reach_customers'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'reach customers capability not selected' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), array_agg(m.moment_key ORDER BY m.moment_key) INTO v_moment_count, v_target_keys
  FROM public.moments m JOIN public.products p ON p.id = m.product_id
  WHERE m.id = ANY(p_moment_ids) AND p.workspace_id = v_workspace_id AND m.status = 'active';
  IF v_moment_count <> v_input_count THEN RAISE EXCEPTION 'one or more target moments are not in the current workspace' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.offers (workspace_id, title, description, cta_label, cta_url, target_moments, status, destination_url, updated_at)
  VALUES (v_workspace_id, trim(p_title), NULLIF(trim(p_description), ''), trim(p_cta_label), p_destination_url, v_target_keys, 'active', p_destination_url, timezone('utc'::text, now()))
  RETURNING id INTO v_offer_id;
  INSERT INTO public.offer_moments (offer_id, moment_id) SELECT v_offer_id, ids.x FROM unnest(p_moment_ids) ids(x);
  RETURN QUERY SELECT v_workspace_id, v_offer_id, v_moment_count;
END;
$$;

-- Explicit-context wrappers. The original RPCs remain available to old clients,
-- but now reject silent first-workspace selection when a user has >1 membership.
CREATE OR REPLACE FUNCTION public.confirm_product_activation_v2(
  p_workspace_id UUID, p_canonical_url TEXT, p_domain TEXT, p_name TEXT, p_description TEXT, p_moments JSONB
)
RETURNS TABLE (workspace_id UUID, product_id UUID, moment_count INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = auth.uid() AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY SELECT * FROM public.confirm_product_activation(p_canonical_url, p_domain, p_name, p_description, p_moments);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_capabilities_v2(p_workspace_id UUID, p_capabilities TEXT[])
RETURNS TABLE (workspace_id UUID, capability TEXT)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = auth.uid() AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY SELECT * FROM public.set_workspace_capabilities(p_capabilities);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_offer_activation_v2(
  p_workspace_id UUID, p_title TEXT, p_description TEXT, p_cta_label TEXT, p_destination_url TEXT, p_moment_ids UUID[]
)
RETURNS TABLE (workspace_id UUID, offer_id UUID, moment_count INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = auth.uid() AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities wc
    WHERE wc.workspace_id = p_workspace_id
      AND wc.capability = 'reach_customers'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'reach customers capability not selected' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('nextaction.workspace_id', p_workspace_id::text, true);
  RETURN QUERY SELECT * FROM public.create_offer_activation(p_title, p_description, p_cta_label, p_destination_url, p_moment_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[]) TO authenticated;
REVOKE ALL ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;

COMMIT;
