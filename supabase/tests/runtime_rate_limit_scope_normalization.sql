BEGIN;

SELECT plan(3);

-- Constant synthetic key is confined to this transaction and rolled back below.
DELETE FROM private.rate_limit_buckets
WHERE subject_hash = repeat('f', 64)
  AND scope IN (
    '__nextaction_rate_limit_scope_test__',
    '  __nextaction_rate_limit_scope_test__  '
  );

SELECT is(
  (
    SELECT request_count
    FROM public.check_runtime_rate_limit(
      '  __nextaction_rate_limit_scope_test__  ',
      repeat('f', 64),
      100,
      86400
    )
  ),
  1,
  'first padded scope request starts at count one'
);

SELECT is(
  (
    SELECT request_count
    FROM public.check_runtime_rate_limit(
      '__nextaction_rate_limit_scope_test__',
      repeat('f', 64),
      100,
      86400
    )
  ),
  2,
  'padded and canonical scope share the same rate-limit counter'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM private.rate_limit_buckets
    WHERE subject_hash = repeat('f', 64)
      AND scope IN (
        '__nextaction_rate_limit_scope_test__',
        '  __nextaction_rate_limit_scope_test__  '
      )
  ),
  1,
  'equivalent scope inputs persist exactly one bucket'
);

SELECT * FROM finish();
ROLLBACK;
