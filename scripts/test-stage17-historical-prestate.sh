#!/usr/bin/env bash
set -euo pipefail

mode="$1"
if [[ "$mode" != "prepare-index" && "$mode" != "prepare-direct" && "$mode" != "verify-index" && "$mode" != "verify-direct" ]]; then
  echo "Usage: $0 prepare-index|prepare-direct|verify-index|verify-direct" >&2
  exit 2
fi

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "No disposable Supabase database container found." >&2
  exit 1
fi

psql_db() {
  docker exec -i "$DB_CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

case "$mode" in
  prepare-index)
    echo "Preparing actual Stage 17 pre-state: standalone unique index, no same-named constraint."
    psql_db -c "
      ALTER TABLE private.settlements
        DROP CONSTRAINT IF EXISTS settlements_qualified_click_id_key;
      CREATE UNIQUE INDEX settlements_qualified_click_id_key
        ON private.settlements(qualified_click_id);
      DO \$prestate\$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint
          WHERE conrelid = 'private.settlements'::regclass
            AND conname = 'settlements_qualified_click_id_key'
        ) THEN
          RAISE EXCEPTION 'index-only pre-state unexpectedly still has the named constraint';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS i
          JOIN pg_catalog.pg_namespace AS n ON n.oid = i.relnamespace
          WHERE n.nspname = 'private'
            AND i.relname = 'settlements_qualified_click_id_key'
            AND i.relkind = 'i'
        ) THEN
          RAISE EXCEPTION 'index-only pre-state did not create the expected standalone unique index';
        END IF;
      END;
      \$prestate\$;
    "
    ;;
  prepare-direct)
    echo "Preparing actual Stage 17 pre-state: neither same-named unique index nor constraint."
    psql_db -c "
      ALTER TABLE private.settlements
        DROP CONSTRAINT IF EXISTS settlements_qualified_click_id_key;
      DO \$prestate\$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint
          WHERE conrelid = 'private.settlements'::regclass
            AND conname = 'settlements_qualified_click_id_key'
        ) THEN
          RAISE EXCEPTION 'direct-unique pre-state still has the named constraint';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS i
          JOIN pg_catalog.pg_namespace AS n ON n.oid = i.relnamespace
          WHERE n.nspname = 'private'
            AND i.relname = 'settlements_qualified_click_id_key'
            AND i.relkind = 'i'
        ) THEN
          RAISE EXCEPTION 'direct-unique pre-state still has the same-named standalone index';
        END IF;
      END;
      \$prestate\$;
    "
    ;;
  verify-index|verify-direct)
    echo "Verifying Stage 17 result for mode: $mode"
    psql_db <<'SQL'
DO $constraint_assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS i ON i.oid = c.conindid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = i.relnamespace
    WHERE c.conrelid = 'private.settlements'::regclass
      AND c.conname = 'settlements_qualified_click_id_key'
      AND c.contype = 'u'
      AND c.convalidated
      AND n.nspname = 'private'
      AND i.relname = 'settlements_qualified_click_id_key'
  ) THEN
    RAISE EXCEPTION 'Stage 17 did not produce the validated named unique constraint';
  END IF;
END;
$constraint_assertion$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000420',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p2-stage17-prestate@contract.invalid', '',
  timezone('utc'::text, now()),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  '{}'::JSONB, timezone('utc'::text, now()), timezone('utc'::text, now())
)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE p2_stage17_fixture AS
SELECT *
FROM public.production_smoke_fixture_create(
  repeat('f', 32),
  '00000000-0000-4000-8000-000000000420'::UUID,
  repeat('a', 64)
);

INSERT INTO private.events (
  id, integration_id, idempotency_key, event_type, occurred_at, payload, request_id
)
SELECT
  '00000000-0000-4000-8000-000000000421'::UUID,
  result_integration_id,
  'p2-stage17-historical-prestate',
  result_moment_key,
  timezone('utc'::text, now()),
  jsonb_build_object('p2_stage17_prestate', true),
  '00000000-0000-4000-8000-000000000428'::UUID
FROM pg_temp.p2_stage17_fixture;

INSERT INTO private.moment_occurrences (
  id, moment_id, event_id, integration_id, occurred_at
)
SELECT
  '00000000-0000-4000-8000-000000000422'::UUID,
  result_moment_id,
  '00000000-0000-4000-8000-000000000421'::UUID,
  result_integration_id,
  timezone('utc'::text, now())
FROM pg_temp.p2_stage17_fixture;

INSERT INTO private.decisions (
  id, moment_occurrence_id, integration_id, outcome, offer_id, reason_code, request_id
)
SELECT
  '00000000-0000-4000-8000-000000000423'::UUID,
  '00000000-0000-4000-8000-000000000422'::UUID,
  result_integration_id,
  'filled',
  result_offer_id,
  'p2_stage17_historical_prestate',
  '00000000-0000-4000-8000-000000000429'::UUID
FROM pg_temp.p2_stage17_fixture;

INSERT INTO private.deliveries (
  id, decision_id, offer_id, integration_id, delivery_nonce, delivery_token_hash, expires_at
)
SELECT
  '00000000-0000-4000-8000-000000000424'::UUID,
  '00000000-0000-4000-8000-000000000423'::UUID,
  result_offer_id,
  result_integration_id,
  'p2-stage17-historical-prestate-delivery',
  repeat('c', 64),
  timezone('utc'::text, now()) + INTERVAL '1 hour'
FROM pg_temp.p2_stage17_fixture;

INSERT INTO private.clicks (
  id, delivery_id, click_token_hash, clicked_at, qualification_status, verification_result
)
VALUES (
  '00000000-0000-4000-8000-000000000425'::UUID,
  '00000000-0000-4000-8000-000000000424'::UUID,
  repeat('d', 64),
  timezone('utc'::text, now()),
  'qualified',
  'p2_stage17_historical_prestate'
);

INSERT INTO private.qualified_clicks (
  id, click_id, qualification_version, reason_code, qualified_at
)
VALUES (
  '00000000-0000-4000-8000-000000000426'::UUID,
  '00000000-0000-4000-8000-000000000425'::UUID,
  'p2_stage17_historical_prestate_v1',
  'p2_stage17_historical_prestate',
  timezone('utc'::text, now())
);

INSERT INTO private.settlements (
  id, qualified_click_id, advertiser_workspace_id, publisher_workspace_id,
  charge_cents, publisher_share_cents, platform_share_cents, currency
)
SELECT
  '00000000-0000-4000-8000-000000000427'::UUID,
  '00000000-0000-4000-8000-000000000426'::UUID,
  result_advertiser_workspace_id,
  result_publisher_workspace_id,
  100, 75, 25, 'USD'
FROM pg_temp.p2_stage17_fixture;

DO $unique_assertion$
BEGIN
  BEGIN
    INSERT INTO private.settlements (
      qualified_click_id, advertiser_workspace_id, publisher_workspace_id,
      charge_cents, publisher_share_cents, platform_share_cents, currency
    )
    SELECT
      '00000000-0000-4000-8000-000000000426'::UUID,
      result_advertiser_workspace_id,
      result_publisher_workspace_id,
      100, 75, 25, 'USD'
    FROM pg_temp.p2_stage17_fixture;

    RAISE EXCEPTION 'duplicate settlement for the same Qualified Click was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: the Stage 17 migration rejects a duplicate settlement for one Qualified Click';
  END;
END;
$unique_assertion$;

DO $historical_source$
DECLARE
  v_definition TEXT;
  v_historical_definition TEXT;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.production_smoke_fixture_verify(uuid,uuid)'::REGPROCEDURE
  )
  INTO v_definition;

  IF position('ORDER BY c.clicked_at DESC, c.id DESC' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'current verifier does not use the actual Click timestamp column';
  END IF;

  IF position('ORDER BY c.created_at DESC, c.id DESC' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'current verifier unexpectedly contains the historical created_at expression';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private' AND table_name = 'clicks' AND column_name = 'clicked_at'
  ) THEN
    RAISE EXCEPTION 'private.clicks.clicked_at does not exist in this schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private' AND table_name = 'clicks' AND column_name = 'created_at'
  ) THEN
    RAISE EXCEPTION 'precondition changed: private.clicks.created_at unexpectedly exists';
  END IF;

  -- Historical commit 694c99a820a8785b7938005d90c10104d19bd616 used the
  -- created_at expression. Rebuild that one historical expression against
  -- the actual historical function definition, then verify the failure mode.
  v_historical_definition := replace(
    v_definition,
    'ORDER BY c.clicked_at DESC, c.id DESC',
    'ORDER BY c.created_at DESC, c.id DESC'
  );
  IF v_historical_definition = v_definition THEN
    RAISE EXCEPTION 'could not reconstruct the historical created_at verifier variant';
  END IF;

  EXECUTE v_historical_definition;
END;
$historical_source$;

DO $historical_runtime$
DECLARE
  v_integration_id UUID;
BEGIN
  SELECT result_integration_id
  INTO v_integration_id
  FROM pg_temp.p2_stage17_fixture;

  BEGIN
    PERFORM public.production_smoke_fixture_verify(
      v_integration_id,
      '00000000-0000-4000-8000-000000000421'::UUID
    );
    RAISE EXCEPTION 'historical verifier unexpectedly succeeded on a schema without Click.created_at';
  EXCEPTION
    WHEN undefined_column THEN
      IF position('created_at' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: historical created_at verifier variant reproduces undefined_column against real Click schema';
  END;
END;
$historical_runtime$;
SQL
    ;;
esac
