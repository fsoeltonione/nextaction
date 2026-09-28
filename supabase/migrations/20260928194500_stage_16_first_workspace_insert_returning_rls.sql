-- Stage 16 follow-up: avoid RLS SELECT dependency during first-workspace bootstrap.
--
-- INSERT ... RETURNING on an RLS-protected table requires the inserting role
-- to also satisfy the table's SELECT policy for the returned row. A new user
-- has no workspace membership until after the owner row is inserted, so the
-- original RETURNING caused the bootstrap to fail at the workspaces INSERT.
--
-- Generate the workspace UUID first and perform the INSERT without RETURNING.
-- The subsequent owner membership makes the workspace visible through the
-- existing membership-scoped SELECT policy.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_product_activation(p_canonical_url text, p_domain text, p_name text, p_description text, p_moments jsonb)
 RETURNS TABLE(result_workspace_id uuid, result_product_id uuid, result_moment_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

  -- Serialize first-workspace bootstrap per user. This prevents two concurrent
  -- confirmations from both observing zero memberships and creating two workspaces.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

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
    v_workspace_id := extensions.gen_random_uuid();
    INSERT INTO public.workspaces (id, name, user_id, created_by)
    VALUES (v_workspace_id, 'My Workspace', v_user_id, v_user_id);
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
$function$;

COMMIT;
