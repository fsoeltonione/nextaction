BEGIN;
SELECT plan(14);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000241',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p2-activation-a@contract.invalid', '',
    timezone('utc'::text, now()), '{"provider":"email","providers":["email"]}'::JSONB,
    '{}'::JSONB, timezone('utc'::text, now()), timezone('utc'::text, now())
  ),
  (
    '00000000-0000-4000-8000-000000000242',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p2-activation-b@contract.invalid', '',
    timezone('utc'::text, now()), '{"provider":"email","providers":["email"]}'::JSONB,
    '{}'::JSONB, timezone('utc'::text, now()), timezone('utc'::text, now())
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, name, user_id, created_by)
VALUES
  (
    '00000000-0000-4000-8000-000000000243',
    'P2 Activation Workspace A',
    '00000000-0000-4000-8000-000000000241',
    '00000000-0000-4000-8000-000000000241'
  ),
  (
    '00000000-0000-4000-8000-000000000244',
    'P2 Activation Workspace B',
    '00000000-0000-4000-8000-000000000242',
    '00000000-0000-4000-8000-000000000242'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES
  ('00000000-0000-4000-8000-000000000243','00000000-0000-4000-8000-000000000241','owner'),
  ('00000000-0000-4000-8000-000000000244','00000000-0000-4000-8000-000000000242','owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.workspace_capabilities (workspace_id, capability, status)
VALUES
  ('00000000-0000-4000-8000-000000000243','reach_customers','active'),
  ('00000000-0000-4000-8000-000000000244','reach_customers','active')
ON CONFLICT (workspace_id, capability)
DO UPDATE SET status = EXCLUDED.status;

INSERT INTO public.products (
  id, workspace_id, domain, name, canonical_url, understanding_status
)
VALUES (
  '00000000-0000-4000-8000-000000000245',
  '00000000-0000-4000-8000-000000000243',
  'p2-activation.invalid',
  'P2 Activation Product',
  'https://p2-activation.invalid',
  'confirmed'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.moments (id, product_id, moment_key, label, description, status)
VALUES (
  '00000000-0000-4000-8000-000000000246',
  '00000000-0000-4000-8000-000000000245',
  'p2_activation_moment',
  'P2 Activation Moment',
  'Disposable activation boundary fixture',
  'active'
)
ON CONFLICT (id) DO NOTHING;

SELECT ok(
  NOT has_function_privilege('anon', 'public.confirm_product_activation_v2(uuid,text,text,text,text,jsonb)', 'EXECUTE'),
  'anon cannot execute the product activation v2 wrapper'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.create_offer_activation_v2(uuid,text,text,text,text,uuid[])', 'EXECUTE'),
  'anon cannot execute the offer activation v2 wrapper'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.create_network_offer_activation_v1(uuid,text,text,text,text,text[])', 'EXECUTE'),
  'anon cannot execute the network-offer activation wrapper'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.set_moment_network_mapping_v1(uuid,text)', 'EXECUTE'),
  'anon cannot execute the Moment-to-Network-Moment mapping wrapper'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000241', true);

SELECT is(
  auth.uid(),
  '00000000-0000-4000-8000-000000000241'::UUID,
  'test session is scoped to workspace A user'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.confirm_product_activation_v2(
    '00000000-0000-4000-8000-000000000244'::UUID,
    'https://p2-wrong-workspace.invalid',
    'p2-wrong-workspace.invalid',
    'Must fail',
    NULL,
    '[{"key":"safe_key","label":"Safe key"}]'::JSONB
  )$p2$,
  '42501',
  'workspace not authorized',
  'member of workspace A cannot activate a product in workspace B'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.create_offer_activation_v2(
    '00000000-0000-4000-8000-000000000244'::UUID,
    'Unauthorized Offer',
    NULL,
    'Open',
    'https://p2-offer.invalid',
    ARRAY[]::UUID[]
  )$p2$,
  '42501',
  'workspace not authorized',
  'member of workspace A cannot create an Offer in workspace B'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.create_network_offer_activation_v1(
    '00000000-0000-4000-8000-000000000244'::UUID,
    'Unauthorized Network Offer',
    NULL,
    'Open',
    'https://p2-network-offer.invalid',
    ARRAY['p2_missing_network_moment']
  )$p2$,
  '42501',
  'workspace not authorized',
  'network Offer activation rejects a workspace outside caller membership'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.create_network_offer_activation_v1(
    '00000000-0000-4000-8000-000000000243'::UUID,
    'Invalid Network Target',
    NULL,
    'Open',
    'https://p2-network-target.invalid',
    ARRAY['p2_missing_network_moment']
  )$p2$,
  '22023',
  'one or more target network moments are not available',
  'network Offer activation rejects a missing or inactive Network Moment target'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.set_moment_network_mapping_v1(
    '00000000-0000-4000-8000-000000000246'::UUID,
    'p2_missing_network_moment'
  )$p2$,
  '22023',
  'network moment is not available',
  'Moment mapping rejects a missing or inactive Network Moment'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.confirm_product_activation_v2(
    '00000000-0000-4000-8000-000000000243'::UUID,
    'not-a-canonical-url',
    'p2-activation.invalid',
    'Invalid URL Product',
    NULL,
    '[{"key":"valid_key","label":"Valid key"}]'::JSONB
  )$p2$,
  '22023',
  'invalid canonical product URL',
  'product activation rejects malformed canonical URLs before writing'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.confirm_product_activation_v2(
    '00000000-0000-4000-8000-000000000243'::UUID,
    'https://p2-empty-moments.invalid',
    'p2-empty-moments.invalid',
    'Empty Moments Product',
    NULL,
    '[]'::JSONB
  )$p2$,
  '22023',
  'between 1 and 20 moments are required',
  'product activation rejects an empty Moment definition array'
);

SELECT throws_ok(
  $p2$SELECT * FROM public.create_offer_activation_v2(
    '00000000-0000-4000-8000-000000000243'::UUID,
    'Invalid Destination Offer',
    NULL,
    'Open',
    'javascript:alert(1)',
    ARRAY['00000000-0000-4000-8000-000000000246'::UUID]
  )$p2$,
  '22023',
  'invalid destination URL',
  'Offer activation rejects a non-HTTP destination URL'
);

RESET ROLE;

UPDATE public.workspace_capabilities
SET status = 'disabled'
WHERE workspace_id = '00000000-0000-4000-8000-000000000243'
  AND capability = 'reach_customers';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000241', true);

SELECT throws_ok(
  $p2$SELECT * FROM public.create_network_offer_activation_v1(
    '00000000-0000-4000-8000-000000000243'::UUID,
    'Missing Capability',
    NULL,
    'Open',
    'https://p2-no-capability.invalid',
    ARRAY['p2_missing_network_moment']
  )$p2$,
  '42501',
  'reach customers capability not selected',
  'network Offer activation is rejected when reach_customers capability is disabled'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
