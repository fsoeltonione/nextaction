-- Stage 15 post-release hardening:
-- Replace the first smoke fixture harness with a transactional production
-- runtime contract. All fixture and runtime writes are rolled back inside a
-- PL/pgSQL subtransaction before the function returns its evidence.
--
-- This preserves immutable runtime/financial tables while still exercising the
-- live production database functions.

BEGIN;

DROP FUNCTION IF EXISTS public.production_smoke_fixture_create(TEXT, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.production_smoke_fixture_verify(TEXT);
DROP FUNCTION IF EXISTS public.production_smoke_fixture_cleanup(TEXT);

CREATE OR REPLACE FUNCTION public.production_runtime_smoke(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_publisher_workspace_id UUID;
  v_advertiser_workspace_id UUID;
  v_product_id UUID;
  v_moment_id UUID;
  v_integration_id UUID;
  v_offer_id UUID;
  v_event_id UUID;
  v_occurrence_id UUID;
  v_decision_id UUID;
  v_delivery_id UUID;
  v_click_id UUID;
  v_qualified_click_id UUID;
  v_settlement_id UUID;
  v_delivery_token TEXT;
  v_credential_hash TEXT;
  v_delivery_token_hash TEXT;
  v_moment_key TEXT;
  v_event_type TEXT;
  v_smoke_id TEXT;
  v_worker_result RECORD;
  v_track_result RECORD;
  v_offer_result RECORD;
  v_click_result RECORD;
  v_settlement_result RECORD;
  v_settlement_replay RECORD;
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  v_smoke_id := replace(gen_random_uuid()::TEXT, '-', '');
  v_moment_key := 'production_smoke_' || left(v_smoke_id, 24);
  v_event_type := v_moment_key;
  v_delivery_token := 'na_prod_smoke_' || v_smoke_id;
  v_credential_hash := encode(extensions.digest(v_delivery_token, 'sha256'), 'hex');
  v_delivery_token_hash := encode(
    extensions.digest(v_delivery_token, 'sha256'),
    'hex'
  );

  BEGIN
    INSERT INTO public.workspaces (name, user_id, created_by)
    VALUES (
      '__nextaction_prod_smoke_' || v_smoke_id || '_publisher',
      p_user_id,
      p_user_id
    )
    RETURNING id INTO v_publisher_workspace_id;

    INSERT INTO public.workspaces (name, user_id, created_by)
    VALUES (
      '__nextaction_prod_smoke_' || v_smoke_id || '_advertiser',
      p_user_id,
      p_user_id
    )
    RETURNING id INTO v_advertiser_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES
      (v_publisher_workspace_id, p_user_id, 'owner'),
      (v_advertiser_workspace_id, p_user_id, 'owner');

    INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
    VALUES
      (v_publisher_workspace_id, 'make_money', 'active'),
      (v_advertiser_workspace_id, 'reach_customers', 'active');

    INSERT INTO public.products (
      workspace_id,
      domain,
      name,
      description,
      canonical_url,
      understanding_status
    )
    VALUES (
      v_publisher_workspace_id,
      'example.com',
      'Production Smoke Publisher',
      'Ephemeral transactional smoke fixture.',
      'https://example.com',
      'confirmed'
    )
    RETURNING id INTO v_product_id;

    INSERT INTO public.moments (
      product_id,
      moment_key,
      label,
      description,
      status
    )
    VALUES (
      v_product_id,
      v_moment_key,
      'Production Smoke Moment',
      'Ephemeral transactional smoke fixture moment.',
      'active'
    )
    RETURNING id INTO v_moment_id;

    INSERT INTO public.integrations (product_id, name, status)
    VALUES (
      v_product_id,
      'Production Smoke Integration',
      'active'
    )
    RETURNING id INTO v_integration_id;

    INSERT INTO private.integration_secrets (
      integration_id,
      credential_hash
    )
    VALUES (
      v_integration_id,
      v_credential_hash
    );

    INSERT INTO public.offers (
      workspace_id,
      title,
      description,
      cta_label,
      cta_url,
      target_moments,
      budget_cents,
      spent_cents,
      status,
      destination_url
    )
    VALUES (
      v_advertiser_workspace_id,
      'Production Smoke Offer',
      'Ephemeral transactional smoke fixture offer.',
      'Open smoke destination',
      'https://example.com/?nextaction_production_smoke=1',
      ARRAY[v_moment_key],
      100,
      0,
      'active',
      'https://example.com/?nextaction_production_smoke=1'
    )
    RETURNING id INTO v_offer_id;

    INSERT INTO public.offer_moments (offer_id, moment_id)
    VALUES (v_offer_id, v_moment_id);

    INSERT INTO private.advertiser_credit_accounts (
      workspace_id,
      granted_units,
      consumed_units,
      available_units
    )
    VALUES (
      v_advertiser_workspace_id,
      1,
      0,
      1
    );

    INSERT INTO private.advertiser_credit_entries (
      workspace_id,
      entry_type,
      units,
      reference_id
    )
    VALUES (
      v_advertiser_workspace_id,
      'grant',
      1,
      NULL
    );

    SELECT *
    INTO v_track_result
    FROM public.runtime_accept_event(
      v_integration_id,
      'production-smoke-' || v_smoke_id,
      v_event_type,
      pg_catalog.clock_timestamp(),
      pg_catalog.jsonb_build_object(
        'smoke_id', v_smoke_id,
        'purpose', 'production-runtime-transactional-smoke'
      ),
      gen_random_uuid()
    )
    LIMIT 1;

    v_event_id := v_track_result.result_event_id;

    SELECT *
    INTO v_worker_result
    FROM public.runtime_worker_tick(20, 60)
    LIMIT 1;

    SELECT mo.id
    INTO v_occurrence_id
    FROM private.moment_occurrences AS mo
    WHERE mo.event_id = v_event_id
    LIMIT 1;

    IF v_occurrence_id IS NULL THEN
      RAISE EXCEPTION 'production smoke worker did not create a Moment occurrence';
    END IF;

    SELECT *
    INTO v_offer_result
    FROM public.runtime_create_decision_delivery(
      v_integration_id,
      v_moment_key,
      gen_random_uuid(),
      'production-smoke-nonce-' || v_smoke_id,
      v_delivery_token_hash,
      pg_catalog.clock_timestamp() + interval '10 minutes'
    )
    LIMIT 1;

    v_decision_id := v_offer_result.result_decision_id;
    v_delivery_id := v_offer_result.result_delivery_id;

    SELECT *
    INTO v_click_result
    FROM public.runtime_record_and_qualify_click(v_delivery_token_hash)
    LIMIT 1;

    v_click_id := v_click_result.result_click_id;
    v_qualified_click_id := v_click_result.result_qualified_click_id;

    SELECT *
    INTO v_settlement_result
    FROM public.runtime_settle_qualified_click(v_qualified_click_id)
    LIMIT 1;

    v_settlement_id := v_settlement_result.result_settlement_id;

    SELECT *
    INTO v_settlement_replay
    FROM public.runtime_settle_qualified_click(v_qualified_click_id)
    LIMIT 1;

    v_result := pg_catalog.jsonb_build_object(
      'track_created', COALESCE(v_track_result.result_created, false),
      'event_id', v_event_id,
      'worker_processed', COALESCE(v_worker_result.result_processed, 0),
      'worker_failed', COALESCE(v_worker_result.result_failed, 0),
      'moment_occurrence_created', (v_occurrence_id IS NOT NULL),
      'decision_outcome', v_offer_result.result_outcome,
      'delivery_created', (v_delivery_id IS NOT NULL),
      'click_outcome', v_click_result.result_outcome,
      'qualification_status', v_click_result.result_qualification_status,
      'qualified_click_created', (v_qualified_click_id IS NOT NULL),
      'settlement_outcome', v_settlement_result.result_outcome,
      'settlement_replay_outcome', v_settlement_replay.result_outcome,
      'settlement_charge_cents', v_settlement_result.result_charge_cents,
      'publisher_share_cents', v_settlement_result.result_publisher_share_cents,
      'platform_share_cents', v_settlement_result.result_platform_share_cents,
      'currency', v_settlement_result.result_currency,
      'settlement_count', (
        SELECT count(*)
        FROM private.settlements
        WHERE qualified_click_id = v_qualified_click_id
      ),
      'financial_entry_count', (
        SELECT count(*)
        FROM private.financial_entries
        WHERE settlement_id = v_settlement_id
      ),
      'financial_debit_cents', (
        SELECT COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'debit'), 0)
        FROM private.financial_entries AS fe
        WHERE fe.settlement_id = v_settlement_id
      ),
      'financial_credit_cents', (
        SELECT COALESCE(sum(fe.amount_cents) FILTER (WHERE fe.entry_type = 'credit'), 0)
        FROM private.financial_entries AS fe
        WHERE fe.settlement_id = v_settlement_id
      ),
      'credit_available_units', (
        SELECT available_units
        FROM private.advertiser_credit_accounts
        WHERE workspace_id = v_advertiser_workspace_id
      ),
      'queue_messages_for_event', (
        SELECT count(*)
        FROM pgmq."q_runtime-events"
        WHERE message->>'event_id' = v_event_id::TEXT
      )
    );

    RAISE EXCEPTION 'production smoke rollback' USING ERRCODE = 'P9998';
  EXCEPTION
    WHEN SQLSTATE 'P9998' THEN
      NULL;
  END;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.production_runtime_smoke(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_runtime_smoke(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.production_runtime_smoke(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.production_runtime_smoke(UUID) TO service_role;

COMMIT;
