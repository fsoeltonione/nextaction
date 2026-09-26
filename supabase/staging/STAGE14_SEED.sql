BEGIN;

CREATE TEMP TABLE stage14_seed_output (
  integration_token TEXT NOT NULL,
  delivery_token TEXT NOT NULL,
  publisher_workspace_id UUID NOT NULL,
  advertiser_workspace_id UUID NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_owner_user_id UUID;
  v_publisher_workspace_id UUID := gen_random_uuid();
  v_advertiser_workspace_id UUID := gen_random_uuid();
  v_publisher_product_id UUID := gen_random_uuid();
  v_moment_id UUID := gen_random_uuid();
  v_integration_id UUID := gen_random_uuid();
  v_offer_id UUID := gen_random_uuid();
  v_decision_id UUID := gen_random_uuid();
  v_delivery_id UUID := gen_random_uuid();
  v_integration_token TEXT := 'na_stage14_' || encode(gen_random_bytes(24), 'hex');
  v_delivery_token TEXT := 'na_stage14_delivery_' || encode(gen_random_bytes(24), 'hex');
BEGIN
  SELECT id INTO v_owner_user_id
  FROM auth.users
  ORDER BY created_at
  LIMIT 1;

  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Stage 14 seed requires at least one staging auth user.';
  END IF;

  INSERT INTO public.workspaces (
    id, name, user_id, created_by
  )
  VALUES
    (
      v_publisher_workspace_id,
      'Stage 14 Publisher',
      v_owner_user_id,
      v_owner_user_id
    ),
    (
      v_advertiser_workspace_id,
      'Stage 14 Advertiser',
      v_owner_user_id,
      v_owner_user_id
    );

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES
    (v_publisher_workspace_id, v_owner_user_id, 'owner'),
    (v_advertiser_workspace_id, v_owner_user_id, 'owner');

  INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
  VALUES
    (v_publisher_workspace_id, 'make_money', 'active'),
    (v_advertiser_workspace_id, 'reach_customers', 'active');

  INSERT INTO public.products (
    id, workspace_id, domain, canonical_url, name, description, understanding_status
  )
  VALUES (
    v_publisher_product_id,
    v_publisher_workspace_id,
    'stage14.example.test',
    'https://stage14.example.test',
    'Stage 14 Publisher',
    'Disposable staging publisher product.',
    'confirmed'
  );

  INSERT INTO public.moments (
    id, product_id, moment_key, label, description, status
  )
  VALUES (
    v_moment_id,
    v_publisher_product_id,
    'stage14_smoke_moment',
    'Stage 14 Smoke Moment',
    'Disposable staging moment for the release gate.',
    'active'
  );

  INSERT INTO public.integrations (
    id, product_id, name, status
  )
  VALUES (
    v_integration_id,
    v_publisher_product_id,
    'stage14-smoke-integration',
    'active'
  );

  INSERT INTO private.integration_secrets (
    integration_id, credential_hash
  )
  VALUES (
    v_integration_id,
    encode(digest(v_integration_token, 'sha256'), 'hex')
  );

  INSERT INTO public.offers (
    id, workspace_id, title, description, cta_label, cta_url,
    target_moments, budget_cents, spent_cents, status, destination_url
  )
  VALUES (
    v_offer_id,
    v_advertiser_workspace_id,
    'Stage 14 Smoke Offer',
    'Disposable staging advertiser offer.',
    'Open',
    'https://example.com/stage14',
    ARRAY['stage14_smoke_moment']::text[],
    2500,
    0,
    'active',
    'https://example.com/stage14'
  );

  INSERT INTO public.offer_moments (offer_id, moment_id)
  VALUES (v_offer_id, v_moment_id);

  INSERT INTO private.decisions (
    id, moment_id, integration_id, outcome, offer_id, reason_code, request_id
  )
  VALUES (
    v_decision_id,
    v_moment_id,
    v_integration_id,
    'filled',
    v_offer_id,
    'stage14_seed',
    gen_random_uuid()
  );

  INSERT INTO private.deliveries (
    id,
    decision_id,
    offer_id,
    integration_id,
    delivery_nonce,
    delivery_token_hash,
    expires_at
  )
  VALUES (
    v_delivery_id,
    v_decision_id,
    v_offer_id,
    v_integration_id,
    'stage14-seed-delivery-' || encode(gen_random_bytes(12), 'hex'),
    encode(digest(v_delivery_token, 'sha256'), 'hex'),
    clock_timestamp() + interval '24 hours'
  );

  INSERT INTO private.advertiser_credit_accounts (
    workspace_id, granted_units, consumed_units, available_units
  )
  VALUES (
    v_advertiser_workspace_id,
    1,
    0,
    1
  );

  INSERT INTO stage14_seed_output (
    integration_token,
    delivery_token,
    publisher_workspace_id,
    advertiser_workspace_id
  )
  VALUES (
    v_integration_token,
    v_delivery_token,
    v_publisher_workspace_id,
    v_advertiser_workspace_id
  );
END;
$$;

SELECT * FROM stage14_seed_output;

COMMIT;
