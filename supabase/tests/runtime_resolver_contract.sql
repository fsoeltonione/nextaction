BEGIN;
SELECT plan(13);

INSERT INTO public.workspaces (id, name, user_id, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  'p2_runtime_resolver_contract',
  NULL,
  '00000000-0000-4000-8000-000000000205'
);

INSERT INTO public.products (
  id, workspace_id, domain, name, canonical_url, understanding_status
)
VALUES (
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000201',
  'p2-resolver.invalid',
  'P2 Resolver Contract',
  'https://p2-resolver.invalid',
  'confirmed'
);

INSERT INTO public.integrations (id, product_id, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000202',
  'P2 Resolver Contract Integration',
  'active'
);

INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
VALUES ('00000000-0000-4000-8000-000000000201', 'make_money', 'active');

INSERT INTO private.integration_secrets (integration_id, credential_hash)
VALUES (
  '00000000-0000-4000-8000-000000000203',
  repeat('a', 64)
);

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration('malformed')),
  'invalid_integration_credential',
  'malformed credential is rejected with the stable invalid-credential outcome'
);

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('f', 64))),
  'invalid_integration_credential',
  'well-formed but unknown credential is indistinguishable from invalid credential'
);

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'ok',
  'active integration with confirmed product and active make_money capability resolves'
);

UPDATE public.products
SET understanding_status = 'proposed'
WHERE id = '00000000-0000-4000-8000-000000000202';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'integration_not_ready',
  'unconfirmed product is not treated as a ready integration'
);

UPDATE public.products
SET understanding_status = 'confirmed'
WHERE id = '00000000-0000-4000-8000-000000000202';

UPDATE public.workspace_capabilities
SET status = 'disabled'
WHERE workspace_id = '00000000-0000-4000-8000-000000000201'
  AND capability = 'make_money';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'make_money_not_active',
  'disabled make_money capability prevents integration use'
);

UPDATE public.workspace_capabilities
SET status = 'active'
WHERE workspace_id = '00000000-0000-4000-8000-000000000201'
  AND capability = 'make_money';

UPDATE public.integrations
SET status = 'revoked'
WHERE id = '00000000-0000-4000-8000-000000000203';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'integration_revoked',
  'revoked integration is rejected'
);

UPDATE public.integrations
SET status = 'active', revoked_at = timezone('utc'::text, now())
WHERE id = '00000000-0000-4000-8000-000000000203';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'integration_revoked',
  'active status does not override a non-null revoked_at timestamp'
);

SELECT ok(
  NOT (
    SELECT to_jsonb(r) ? 'credential_hash'
      OR to_jsonb(r)::TEXT LIKE '%' || repeat('a', 64) || '%'
    FROM public.resolve_runtime_integration(repeat('a', 64)) AS r
  ),
  'resolver response does not expose credential hash or secret material'
);


UPDATE public.integrations
SET status = 'active', revoked_at = NULL
WHERE id = '00000000-0000-4000-8000-000000000203';

DELETE FROM public.workspace_capabilities
WHERE workspace_id = '00000000-0000-4000-8000-000000000201'
  AND capability = 'make_money';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'make_money_not_active',
  'missing make_money capability row fails closed'
);

DELETE FROM private.integration_secrets
WHERE integration_id = '00000000-0000-4000-8000-000000000203';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'invalid_integration_credential',
  'missing integration secret row is indistinguishable from an unknown credential'
);

DELETE FROM public.integrations
WHERE id = '00000000-0000-4000-8000-000000000203';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'invalid_integration_credential',
  'deleting an integration cascades its secret and makes the former credential fail closed'
);

INSERT INTO public.integrations (id, product_id, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000202',
  'P2 Resolver Contract Integration',
  'active'
);
INSERT INTO private.integration_secrets (integration_id, credential_hash)
VALUES ('00000000-0000-4000-8000-000000000203', repeat('a', 64));

DELETE FROM public.products
WHERE id = '00000000-0000-4000-8000-000000000202';

SELECT is(
  (SELECT result_status FROM public.resolve_runtime_integration(repeat('a', 64))),
  'invalid_integration_credential',
  'missing Product dependency removes the credential mapping and fails closed'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.products'::REGCLASS
      AND c.contype = 'f'
      AND c.convalidated
      AND a.attname = 'workspace_id'
      AND c.confrelid = 'public.workspaces'::REGCLASS
      AND c.confdeltype = 'c'
  ),
  'validated Product-to-Workspace foreign key prevents an orphan Workspace reference'
);

SELECT * FROM finish();
ROLLBACK;
