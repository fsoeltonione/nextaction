#!/usr/bin/env bash
set -euo pipefail

# Independent-session assertions against the disposable Supabase DB only.
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "No disposable Supabase database container found." >&2
  exit 1
fi

psql_db() {
  docker exec -i "$DB_CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

TMP_DIR="$(mktemp -d)"
cleanup() {
  psql_db -c "
    DROP TRIGGER IF EXISTS p2_test_pause_deadletter ON private.runtime_dead_letters;
    DROP FUNCTION IF EXISTS private.p2_test_pause_deadletter();
    DROP TRIGGER IF EXISTS p2_test_pause_settlement ON private.settlements;
    DROP FUNCTION IF EXISTS private.p2_test_pause_settlement();
  " >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "== Worker queue claim race (two independent sessions) =="
psql_db -c "
  CREATE OR REPLACE FUNCTION private.p2_test_pause_deadletter()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
  AS \$fn\$
  BEGIN
    IF NEW.message->>'p2_concurrency' = 'worker' THEN
      PERFORM pg_catalog.pg_sleep(2);
    END IF;
    RETURN NEW;
  END;
  \$fn\$;
  CREATE TRIGGER p2_test_pause_deadletter
    BEFORE INSERT ON private.runtime_dead_letters
    FOR EACH ROW EXECUTE FUNCTION private.p2_test_pause_deadletter();
  SELECT pgmq.send('runtime-events', jsonb_build_object('p2_concurrency', 'worker'));
" >/dev/null

psql_db -c "SELECT result_processed || ':' || result_failed FROM public.runtime_worker_tick(1, 5);" >"$TMP_DIR/worker-a.out" &
worker_a=$!
sleep 0.35
psql_db -c "SELECT result_processed || ':' || result_failed FROM public.runtime_worker_tick(1, 5);" >"$TMP_DIR/worker-b.out" &
worker_b=$!
wait "$worker_a"
wait "$worker_b"

worker_results="$(cat "$TMP_DIR/worker-a.out" "$TMP_DIR/worker-b.out" | sed '/^[[:space:]]*$/d' | sort | paste -sd ',' -)"
if [[ "$worker_results" != "0:0,0:1" ]]; then
  echo "Unexpected concurrent worker results: [$worker_results]" >&2
  cat "$TMP_DIR/worker-a.out" "$TMP_DIR/worker-b.out" >&2
  exit 1
fi

dead_letter_count="$(psql_db -c "SELECT count(*) FROM private.runtime_dead_letters WHERE message->>'p2_concurrency' = 'worker';" | tr -d '[:space:]')"
active_queue_count="$(psql_db -c "SELECT count(*) FROM pgmq.\"q_runtime-events\" WHERE message->>'p2_concurrency' = 'worker';" | tr -d '[:space:]')"
[[ "$dead_letter_count" == "1" ]] || { echo "Expected one worker dead letter, got $dead_letter_count" >&2; exit 1; }
[[ "$active_queue_count" == "0" ]] || { echo "Expected the message archived, got active count $active_queue_count" >&2; exit 1; }
echo "PASS: one worker handled and archived the malformed message; the concurrent worker did not claim it."

psql_db -c "
  DROP TRIGGER IF EXISTS p2_test_pause_deadletter ON private.runtime_dead_letters;
  DROP FUNCTION IF EXISTS private.p2_test_pause_deadletter();
" >/dev/null

echo "== Settlement idempotency race (two independent sessions) =="
psql_db -c "
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  VALUES (
    '00000000-0000-4000-8000-000000000411',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p2-concurrent-settlement@contract.invalid', '',
    timezone('utc'::text, now()),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::JSONB, timezone('utc'::text, now()), timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO NOTHING;
" >/dev/null

fixture="$(
  psql_db -c "
    SELECT
      result_publisher_workspace_id::text || '|' ||
      result_advertiser_workspace_id::text || '|' ||
      result_integration_id::text || '|' ||
      result_offer_id::text
    FROM public.production_smoke_fixture_create(
      repeat('a', 32),
      '00000000-0000-4000-8000-000000000411'::UUID,
      repeat('b', 64)
    );
  " | tr -d '[:space:]'
)"
IFS='|' read -r publisher_workspace advertiser_workspace integration_id offer_id <<<"$fixture"
if [[ -z "$publisher_workspace" || -z "$advertiser_workspace" || -z "$integration_id" || -z "$offer_id" ]]; then
  echo "Could not read disposable settlement fixture IDs: [$fixture]" >&2
  exit 1
fi

psql_db -c "
  INSERT INTO private.decisions (
    id, moment_occurrence_id, integration_id, outcome, offer_id, reason_code, request_id
  )
  VALUES (
    '00000000-0000-4000-8000-000000000412', NULL, '$integration_id', 'filled',
    '$offer_id', 'p2_concurrent_settlement', '00000000-0000-4000-8000-000000000416'
  );
  INSERT INTO private.deliveries (
    id, decision_id, offer_id, integration_id, delivery_nonce, delivery_token_hash, expires_at
  )
  VALUES (
    '00000000-0000-4000-8000-000000000413',
    '00000000-0000-4000-8000-000000000412',
    '$offer_id',
    '$integration_id',
    'p2-concurrent-settlement-nonce',
    repeat('c', 64),
    timezone('utc'::text, now()) + INTERVAL '1 hour'
  );
  INSERT INTO private.clicks (
    id, delivery_id, click_token_hash, clicked_at, qualification_status, verification_result
  )
  VALUES (
    '00000000-0000-4000-8000-000000000414',
    '00000000-0000-4000-8000-000000000413',
    repeat('d', 64),
    timezone('utc'::text, now()),
    'qualified',
    'p2_concurrent_settlement'
  );
  INSERT INTO private.qualified_clicks (
    id, click_id, qualification_version, reason_code, qualified_at
  )
  VALUES (
    '00000000-0000-4000-8000-000000000415',
    '00000000-0000-4000-8000-000000000414',
    'p2_concurrent_settlement_v1',
    'p2_concurrent_settlement',
    timezone('utc'::text, now())
  );
  CREATE OR REPLACE FUNCTION private.p2_test_pause_settlement()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
  AS \$fn\$
  BEGIN
    IF NEW.qualified_click_id = '00000000-0000-4000-8000-000000000415'::UUID THEN
      PERFORM pg_catalog.pg_sleep(2);
    END IF;
    RETURN NEW;
  END;
  \$fn\$;
  CREATE TRIGGER p2_test_pause_settlement
    BEFORE INSERT ON private.settlements
    FOR EACH ROW EXECUTE FUNCTION private.p2_test_pause_settlement();
" >/dev/null

psql_db -c "SELECT result_outcome FROM public.runtime_settle_qualified_click('00000000-0000-4000-8000-000000000415'::UUID);" >"$TMP_DIR/settlement-a.out" &
settlement_a=$!
sleep 0.35
psql_db -c "SELECT result_outcome FROM public.runtime_settle_qualified_click('00000000-0000-4000-8000-000000000415'::UUID);" >"$TMP_DIR/settlement-b.out" &
settlement_b=$!
wait "$settlement_a"
wait "$settlement_b"

settlement_results="$(cat "$TMP_DIR/settlement-a.out" "$TMP_DIR/settlement-b.out" | sed '/^[[:space:]]*$/d' | sort | paste -sd ',' -)"
if [[ "$settlement_results" != "replayed,settled" ]]; then
  echo "Unexpected concurrent settlement outcomes: [$settlement_results]" >&2
  cat "$TMP_DIR/settlement-a.out" "$TMP_DIR/settlement-b.out" >&2
  exit 1
fi

settlement_totals="$(
  psql_db -c "
    SELECT
      (SELECT count(*) FROM private.settlements
       WHERE qualified_click_id = '00000000-0000-4000-8000-000000000415'::UUID) || '|' ||
      (SELECT count(*) FROM private.financial_entries fe
       JOIN private.settlements s ON s.id = fe.settlement_id
       WHERE s.qualified_click_id = '00000000-0000-4000-8000-000000000415'::UUID) || '|' ||
      (SELECT count(*) FROM private.advertiser_credit_entries ce
       WHERE ce.workspace_id = '$advertiser_workspace'::UUID
         AND ce.entry_type = 'consumption'
         AND ce.reference_id = (
           SELECT id FROM private.settlements
           WHERE qualified_click_id = '00000000-0000-4000-8000-000000000415'::UUID
         )) || '|' ||
      (SELECT available_units FROM private.advertiser_credit_accounts
       WHERE workspace_id = '$advertiser_workspace'::UUID);
  " | tr -d '[:space:]'
)"
if [[ "$settlement_totals" != "1|3|1|0" ]]; then
  echo "Concurrent settlement invariant failed: expected 1 settlement, 3 ledger rows, 1 consumption, 0 capacity; got [$settlement_totals]" >&2
  exit 1
fi
echo "PASS: simultaneous settlement calls committed one settlement, three ledger rows and one credit consumption."

psql_db -c "
  DROP TRIGGER IF EXISTS p2_test_pause_settlement ON private.settlements;
  DROP FUNCTION IF EXISTS private.p2_test_pause_settlement();
" >/dev/null

echo "== First-workspace bootstrap race (two independent sessions) =="
psql_db -c "
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  VALUES (
    '00000000-0000-4000-8000-000000000431',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p2-concurrent-bootstrap@contract.invalid', '',
    timezone('utc'::text, now()),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::JSONB, timezone('utc'::text, now()), timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO NOTHING;
" >/dev/null

bootstrap_call() {
  psql_db -c "
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000431', false);
    SELECT * FROM public.confirm_product_activation_v2(
      NULL::UUID,
      'https://p2-first-workspace.invalid',
      'p2-first-workspace.invalid',
      'P2 First Workspace Bootstrap',
      NULL,
      jsonb_build_array(jsonb_build_object('key', 'first_moment', 'label', 'First Moment'))
    );
  "
}
bootstrap_call >"$TMP_DIR/bootstrap-a.out" 2>&1 &
bootstrap_a=$!
sleep 0.2
bootstrap_call >"$TMP_DIR/bootstrap-b.out" 2>&1 &
bootstrap_b=$!
set +e
wait "$bootstrap_a"; bootstrap_a_status=$?
wait "$bootstrap_b"; bootstrap_b_status=$?
set -e

if [[ "$bootstrap_a_status" -ne 0 && "$bootstrap_b_status" -ne 0 ]]; then
  echo "Both concurrent bootstrap calls failed." >&2
  cat "$TMP_DIR/bootstrap-a.out" "$TMP_DIR/bootstrap-b.out" >&2
  exit 1
fi

bootstrap_counts="$(
  psql_db -c "
    SELECT
      (SELECT count(*) FROM public.workspaces
       WHERE user_id = '00000000-0000-4000-8000-000000000431'::UUID) || '|' ||
      (SELECT count(*) FROM public.products
       WHERE canonical_url = 'https://p2-first-workspace.invalid') || '|' ||
      (SELECT count(*) FROM public.moments m
       JOIN public.products p ON p.id = m.product_id
       WHERE p.canonical_url = 'https://p2-first-workspace.invalid');
  " | tr -d '[:space:]'
)"
if [[ "$bootstrap_counts" != "1|1|1" ]]; then
  echo "Concurrent first-workspace bootstrap created an unexpected shape: [$bootstrap_counts]" >&2
  cat "$TMP_DIR/bootstrap-a.out" "$TMP_DIR/bootstrap-b.out" >&2
  exit 1
fi
echo "PASS: concurrent first-workspace calls persist exactly one Workspace, Product, and Moment."

echo "PASS: all cross-session contracts completed against the disposable database."
