BEGIN;
SELECT plan(8);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'private.settlements'::REGCLASS
      AND c.conname = 'settlements_qualified_click_id_key'
      AND c.contype = 'u'
      AND c.convalidated
      AND pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (qualified_click_id)'
  ),
  'live settlement table has a validated unique Qualified Click constraint'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.conindid
    WHERE c.conrelid = 'private.settlements'::REGCLASS
      AND c.conname = 'settlements_qualified_click_id_key'
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
  ),
  'settlement uniqueness is backed by a valid and ready unique index'
);

SELECT throws_ok(
  $$SELECT * FROM public.runtime_settle_qualified_click(NULL::UUID)$$,
  '22023',
  'qualified click id is required',
  'settlement RPC rejects a NULL Qualified Click ID before any write'
);

SELECT is(
  (
    SELECT result_outcome
    FROM public.runtime_settle_qualified_click('00000000-0000-4000-8000-000000000288'::UUID)
  ),
  'not_found',
  'settlement RPC reports not_found for an unknown Qualified Click'
);

CREATE TEMP TABLE p2_settlement_using_index_probe (
  qualified_click_id UUID NOT NULL
);
CREATE UNIQUE INDEX p2_settlement_using_index_probe_idx
  ON pg_temp.p2_settlement_using_index_probe (qualified_click_id);
ALTER TABLE pg_temp.p2_settlement_using_index_probe
  ADD CONSTRAINT p2_settlement_using_index_probe_uq
  UNIQUE USING INDEX p2_settlement_using_index_probe_idx;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'pg_temp.p2_settlement_using_index_probe'::REGCLASS
      AND c.conname = 'p2_settlement_using_index_probe_uq'
      AND c.contype = 'u'
      AND c.convalidated
  ),
  'reconciliation branch that reuses an existing unique index produces a validated constraint'
);

INSERT INTO pg_temp.p2_settlement_using_index_probe VALUES ('00000000-0000-4000-8000-000000000281');

SELECT throws_ok(
  $$INSERT INTO pg_temp.p2_settlement_using_index_probe VALUES ('00000000-0000-4000-8000-000000000281')$$,
  '23505',
  'duplicate key value violates unique constraint "p2_settlement_using_index_probe_uq"',
  'existing-index reconciliation branch enforces duplicate rejection'
);

CREATE TEMP TABLE p2_settlement_direct_constraint_probe (
  qualified_click_id UUID NOT NULL,
  CONSTRAINT p2_settlement_direct_constraint_probe_uq UNIQUE (qualified_click_id)
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'pg_temp.p2_settlement_direct_constraint_probe'::REGCLASS
      AND c.conname = 'p2_settlement_direct_constraint_probe_uq'
      AND c.contype = 'u'
      AND c.convalidated
  ),
  'reconciliation branch that creates UNIQUE(column) produces a validated constraint'
);

INSERT INTO pg_temp.p2_settlement_direct_constraint_probe VALUES ('00000000-0000-4000-8000-000000000280');

SELECT throws_ok(
  $$INSERT INTO pg_temp.p2_settlement_direct_constraint_probe VALUES ('00000000-0000-4000-8000-000000000280')$$,
  '23505',
  'duplicate key value violates unique constraint "p2_settlement_direct_constraint_probe_uq"',
  'direct UNIQUE(column) branch enforces duplicate rejection'
);

SELECT * FROM finish();
ROLLBACK;
