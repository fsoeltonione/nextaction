BEGIN;
SELECT plan(4);

CREATE TEMP TABLE p2_uuid_qualified_default (
  id UUID NOT NULL DEFAULT extensions.gen_random_uuid()
);

CREATE TEMP TABLE p2_uuid_unqualified_default (
  id UUID NOT NULL DEFAULT gen_random_uuid()
);

INSERT INTO pg_temp.p2_uuid_qualified_default DEFAULT VALUES;
INSERT INTO pg_temp.p2_uuid_unqualified_default DEFAULT VALUES;

SELECT ok(
  (SELECT id IS NOT NULL AND pg_typeof(id) = 'uuid'::REGTYPE
   FROM pg_temp.p2_uuid_qualified_default),
  'schema-qualified UUID default resolves and returns a UUID'
);

SELECT ok(
  (SELECT id IS NOT NULL AND pg_typeof(id) = 'uuid'::REGTYPE
   FROM pg_temp.p2_uuid_unqualified_default),
  'unqualified UUID default resolves and returns a UUID'
);

SELECT ok(
  to_regprocedure('extensions.gen_random_uuid()') IS NOT NULL,
  'schema-qualified extension function exists in the disposable database'
);

SELECT ok(
  to_regprocedure('gen_random_uuid()') IS NOT NULL,
  'unqualified UUID function resolves in the disposable database'
);

SELECT * FROM finish();
ROLLBACK;
