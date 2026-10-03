-- NextAction H3.1: Network Moment model
-- Additive only. Product Moments remain product-scoped and legacy offer_moments
-- remains valid during migration.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Controlled platform-owned Network Moment catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.network_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT network_moments_key_check
    CHECK (
      key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
      AND length(key) BETWEEN 1 AND 100
    ),
  CONSTRAINT network_moments_label_check
    CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  CONSTRAINT network_moments_description_check
    CHECK (description IS NULL OR length(description) <= 2000),
  CONSTRAINT network_moments_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT network_moments_key_uq UNIQUE (key)
);

ALTER TABLE public.network_moments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.network_moments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.network_moments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.network_moments TO service_role;

CREATE POLICY network_moments_authenticated_read_active
  ON public.network_moments
  FOR SELECT
  TO authenticated
  USING (status = 'active');

-- ---------------------------------------------------------------------------
-- 2. Product Moment -> Network Moment mapping
-- ---------------------------------------------------------------------------

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS network_moment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'moments_network_moment_id_fkey'
      AND conrelid = 'public.moments'::regclass
  ) THEN
    ALTER TABLE public.moments
      ADD CONSTRAINT moments_network_moment_id_fkey
      FOREIGN KEY (network_moment_id)
      REFERENCES public.network_moments(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS moments_network_moment_id_idx
  ON public.moments(network_moment_id);

-- ---------------------------------------------------------------------------
-- 3. Advertiser Network Moment targeting relation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.offer_network_moments (
  offer_id UUID NOT NULL,
  network_moment_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT offer_network_moments_pkey
    PRIMARY KEY (offer_id, network_moment_id),
  CONSTRAINT offer_network_moments_offer_id_fkey
    FOREIGN KEY (offer_id)
    REFERENCES public.offers(id)
    ON DELETE CASCADE,
  CONSTRAINT offer_network_moments_network_moment_id_fkey
    FOREIGN KEY (network_moment_id)
    REFERENCES public.network_moments(id)
    ON DELETE RESTRICT
);

ALTER TABLE public.offer_network_moments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.offer_network_moments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.offer_network_moments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.offer_network_moments TO service_role;

CREATE INDEX IF NOT EXISTS offer_network_moments_network_moment_id_idx
  ON public.offer_network_moments(network_moment_id);

CREATE POLICY offer_network_moments_authenticated_read_member_offers
  ON public.offer_network_moments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.offers AS o
      JOIN public.workspace_members AS wm
        ON wm.workspace_id = o.workspace_id
      WHERE o.id = offer_network_moments.offer_id
        AND wm.user_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Server-controlled Product Moment mapping boundary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_moment_network_mapping_v1(
  p_moment_id UUID,
  p_network_moment_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  result_moment_id UUID,
  result_network_moment_id UUID,
  result_network_moment_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_workspace_id UUID;
  v_moment_status TEXT;
  v_network_moment_id UUID;
  v_network_moment_key TEXT;
  v_input_key TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_moment_id IS NULL THEN
    RAISE EXCEPTION 'moment is required' USING ERRCODE = '22023';
  END IF;

  SELECT
    m.status,
    p.workspace_id
  INTO
    v_moment_status,
    v_workspace_id
  FROM public.moments AS m
  JOIN public.products AS p
    ON p.id = m.product_id
  WHERE m.id = p_moment_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'moment not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members AS wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'workspace not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_moment_status <> 'active' THEN
    RAISE EXCEPTION 'moment is not active' USING ERRCODE = '22023';
  END IF;

  IF p_network_moment_key IS NULL THEN
    UPDATE public.moments
    SET network_moment_id = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_moment_id;
  ELSE
    v_input_key := lower(btrim(p_network_moment_key));

    IF v_input_key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
       OR length(v_input_key) > 100
    THEN
      RAISE EXCEPTION 'network moment key is invalid' USING ERRCODE = '22023';
    END IF;

    SELECT nm.id, nm.key
    INTO v_network_moment_id, v_network_moment_key
    FROM public.network_moments AS nm
    WHERE nm.key = v_input_key
      AND nm.status = 'active'
    LIMIT 1;

    IF v_network_moment_id IS NULL THEN
      RAISE EXCEPTION 'network moment is not available' USING ERRCODE = '22023';
    END IF;

    UPDATE public.moments
    SET network_moment_id = v_network_moment_id,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_moment_id;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.network_moment_id,
    nm.key
  FROM public.moments AS m
  LEFT JOIN public.network_moments AS nm
    ON nm.id = m.network_moment_id
  WHERE m.id = p_moment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_moment_network_mapping_v1(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_moment_network_mapping_v1(UUID, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Network-targeted Offer activation boundary
-- ---------------------------------------------------------------------------

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
    RAISE EXCEPTION 'one or more target network moments are not available' USING ERRCODE = '42501';
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

-- ---------------------------------------------------------------------------
-- 6. H3.1 runtime resolution: Network Moment first, legacy fallback second
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.runtime_create_decision_delivery(
  p_integration_id UUID,
  p_moment_key TEXT,
  p_request_id UUID,
  p_delivery_nonce TEXT,
  p_delivery_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  result_outcome TEXT,
  result_reason_code TEXT,
  result_decision_id UUID,
  result_delivery_id UUID,
  result_offer_id UUID,
  result_title TEXT,
  result_description TEXT,
  result_cta_label TEXT,
  result_destination_url TEXT,
  result_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_network_moment_id UUID;
  v_occurrence_id UUID;
  v_offer_id UUID;
  v_title TEXT;
  v_description TEXT;
  v_cta_label TEXT;
  v_destination_url TEXT;
  v_decision_id UUID;
  v_delivery_id UUID;
BEGIN
  IF p_moment_key IS NULL
     OR p_moment_key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
     OR length(p_moment_key) > 100
  THEN
    RAISE EXCEPTION 'invalid moment key' USING ERRCODE = '22023';
  END IF;

  SELECT i.product_id, p.workspace_id
  INTO v_product_id, v_workspace_id
  FROM public.integrations AS i
  JOIN public.products AS p
    ON p.id = i.product_id
  WHERE i.id = p_integration_id
    AND i.status = 'active'
    AND i.revoked_at IS NULL
    AND p.understanding_status = 'confirmed';

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'integration is not active' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_capabilities AS wc
    WHERE wc.workspace_id = v_workspace_id
      AND wc.capability = 'make_money'
      AND wc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'make_money capability is not active' USING ERRCODE = '42501';
  END IF;

  SELECT m.id, nm.id
  INTO v_moment_id, v_network_moment_id
  FROM public.moments AS m
  LEFT JOIN public.network_moments AS nm
    ON nm.id = m.network_moment_id
   AND nm.status = 'active'
  WHERE m.product_id = v_product_id
    AND m.moment_key = p_moment_key
    AND m.status = 'active'
  LIMIT 1;

  IF v_moment_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      NULL,
      NULL,
      p_integration_id,
      'no_fill',
      NULL,
      'moment_not_found',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'moment_not_found'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT mo.id
  INTO v_occurrence_id
  FROM private.moment_occurrences AS mo
  WHERE mo.integration_id = p_integration_id
    AND mo.moment_id = v_moment_id
    AND mo.occurred_at >= pg_catalog.clock_timestamp() - INTERVAL '10 minutes'
  ORDER BY mo.occurred_at DESC, mo.id DESC
  LIMIT 1;

  IF v_occurrence_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      v_moment_id,
      NULL,
      p_integration_id,
      'no_fill',
      NULL,
      'moment_occurrence_not_available',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'moment_occurrence_not_available'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- New network path. If the Product Moment has an active Network Moment,
  -- only normalized Network Moment targeting participates in the first pass.
  IF v_network_moment_id IS NOT NULL THEN
    SELECT
      o.id,
      o.title,
      o.description,
      o.cta_label,
      o.destination_url
    INTO
      v_offer_id,
      v_title,
      v_description,
      v_cta_label,
      v_destination_url
    FROM public.offer_network_moments AS onm
    JOIN public.offers AS o
      ON o.id = onm.offer_id
    JOIN public.workspace_capabilities AS wc
      ON wc.workspace_id = o.workspace_id
     AND wc.capability = 'reach_customers'
     AND wc.status = 'active'
    JOIN private.advertiser_credit_accounts AS aca
      ON aca.workspace_id = o.workspace_id
     AND aca.available_units > 0
    WHERE onm.network_moment_id = v_network_moment_id
      AND o.status = 'active'
      AND o.workspace_id <> v_workspace_id
    ORDER BY o.created_at DESC, o.id
    LIMIT 1;
  END IF;

  -- Migration-safe fallback: existing product-scoped offer_moments remain
  -- eligible when the new network path does not produce a candidate.
  IF v_offer_id IS NULL THEN
    SELECT
      o.id,
      o.title,
      o.description,
      o.cta_label,
      o.destination_url
    INTO
      v_offer_id,
      v_title,
      v_description,
      v_cta_label,
      v_destination_url
    FROM public.offer_moments AS om
    JOIN public.offers AS o
      ON o.id = om.offer_id
    JOIN public.workspace_capabilities AS wc
      ON wc.workspace_id = o.workspace_id
     AND wc.capability = 'reach_customers'
     AND wc.status = 'active'
    JOIN private.advertiser_credit_accounts AS aca
      ON aca.workspace_id = o.workspace_id
     AND aca.available_units > 0
    WHERE om.moment_id = v_moment_id
      AND o.status = 'active'
      AND o.workspace_id <> v_workspace_id
    ORDER BY o.created_at DESC, o.id
    LIMIT 1;
  END IF;

  IF v_offer_id IS NULL THEN
    INSERT INTO private.decisions (
      moment_id,
      moment_occurrence_id,
      integration_id,
      outcome,
      offer_id,
      reason_code,
      request_id
    )
    VALUES (
      v_moment_id,
      v_occurrence_id,
      p_integration_id,
      'no_fill',
      NULL,
      'no_eligible_offer',
      p_request_id
    )
    RETURNING id INTO v_decision_id;

    RETURN QUERY
    SELECT
      'no_fill'::TEXT,
      'no_eligible_offer'::TEXT,
      v_decision_id,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_delivery_nonce IS NULL
     OR length(p_delivery_nonce) < 16
     OR length(p_delivery_nonce) > 200
     OR p_delivery_token_hash IS NULL
     OR p_delivery_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
  THEN
    RAISE EXCEPTION 'delivery token metadata is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.decisions (
    moment_id,
    moment_occurrence_id,
    integration_id,
    outcome,
    offer_id,
    reason_code,
    request_id
  )
  VALUES (
    v_moment_id,
    v_occurrence_id,
    p_integration_id,
    'filled',
    v_offer_id,
    NULL,
    p_request_id
  )
  RETURNING id INTO v_decision_id;

  INSERT INTO private.deliveries (
    decision_id,
    offer_id,
    integration_id,
    delivery_nonce,
    delivery_token_hash,
    expires_at
  )
  VALUES (
    v_decision_id,
    v_offer_id,
    p_integration_id,
    p_delivery_nonce,
    p_delivery_token_hash,
    p_expires_at
  )
  RETURNING id INTO v_delivery_id;

  RETURN QUERY
  SELECT
    'filled'::TEXT,
    NULL::TEXT,
    v_decision_id,
    v_delivery_id,
    v_offer_id,
    v_title,
    v_description,
    v_cta_label,
    v_destination_url,
    p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_create_decision_delivery(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_create_decision_delivery(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. H3.1 release proof: schema, access, mapping integrity, runtime wiring
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.runtime_h3_1_release_proof()
RETURNS TABLE (
  ready BOOLEAN,
  schema_ready BOOLEAN,
  access_ready BOOLEAN,
  runtime_ready BOOLEAN,
  invalid_mapping_count BIGINT,
  inactive_target_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_schema_ready BOOLEAN;
  v_access_ready BOOLEAN;
  v_runtime_ready BOOLEAN;
  v_invalid_mapping_count BIGINT;
  v_inactive_target_count BIGINT;
  v_runtime_source TEXT;
BEGIN
  v_schema_ready :=
    EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'network_moments'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'moments'
        AND column_name = 'network_moment_id'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'offer_network_moments'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'moments_network_moment_id_fkey'
        AND conrelid = 'public.moments'::regclass
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'offer_network_moments_network_moment_id_fkey'
        AND conrelid = 'public.offer_network_moments'::regclass
    );

  SELECT count(*)
  INTO v_invalid_mapping_count
  FROM public.moments AS m
  WHERE m.network_moment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.network_moments AS nm
      WHERE nm.id = m.network_moment_id
    );

  SELECT count(*)
  INTO v_inactive_target_count
  FROM public.offer_network_moments AS onm
  JOIN public.network_moments AS nm
    ON nm.id = onm.network_moment_id
  WHERE nm.status <> 'active';

  SELECT pg_catalog.pg_get_functiondef(p.oid)
  INTO v_runtime_source
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'runtime_create_decision_delivery'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_integration_id uuid, p_moment_key text, p_request_id uuid, p_delivery_nonce text, p_delivery_token_hash text, p_expires_at timestamp with time zone'
  LIMIT 1;

  v_access_ready :=
    pg_catalog.has_table_privilege('service_role', 'public.network_moments', 'SELECT')
    AND pg_catalog.has_table_privilege('service_role', 'public.network_moments', 'INSERT')
    AND pg_catalog.has_table_privilege('authenticated', 'public.network_moments', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.network_moments', 'INSERT')
    AND pg_catalog.has_table_privilege('service_role', 'public.offer_network_moments', 'SELECT')
    AND pg_catalog.has_table_privilege('service_role', 'public.offer_network_moments', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.offer_network_moments', 'INSERT')
    AND pg_catalog.has_function_privilege(
      'authenticated',
      'public.set_moment_network_mapping_v1(uuid,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'anon',
      'public.set_moment_network_mapping_v1(uuid,text)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_network_offer_activation_v1(uuid,text,text,text,text,text[])',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'anon',
      'public.create_network_offer_activation_v1(uuid,text,text,text,text,text[])',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'service_role',
      'public.runtime_h3_1_release_proof()',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.runtime_h3_1_release_proof()',
      'EXECUTE'
    );

  v_runtime_ready :=
    v_runtime_source IS NOT NULL
    AND position('offer_network_moments' in v_runtime_source) > 0
    AND position('network_moment_id' in v_runtime_source) > 0
    AND position('offer_moments' in v_runtime_source) > 0
    AND position('ORDER BY o.created_at DESC, o.id' in v_runtime_source) > 0;

  RETURN QUERY
  SELECT
    v_schema_ready
      AND v_access_ready
      AND v_runtime_ready
      AND v_invalid_mapping_count = 0
      AND v_inactive_target_count = 0,
    v_schema_ready,
    v_access_ready,
    v_runtime_ready,
    v_invalid_mapping_count,
    v_inactive_target_count;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_h3_1_release_proof()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_h3_1_release_proof()
  TO service_role;

COMMIT;
