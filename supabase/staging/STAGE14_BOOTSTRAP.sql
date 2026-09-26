-- NextAction Stage 14 staging bootstrap
-- Staging-only compatibility baseline for the original prototype tables and
-- one disposable auth owner used by STAGE14_SEED.sql.
--
-- This file is NOT a production migration.
BEGIN;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  is_anonymous
)
SELECT
  extensions.gen_random_uuid(),
  'authenticated',
  'authenticated',
  'stage14-smoke@nextaction.invalid',
  '',
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp(),
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM auth.users
  WHERE email = 'stage14-smoke@nextaction.invalid'
);

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.moments (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  moment_key TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (product_id, moment_key)
);

CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cta_label TEXT NOT NULL DEFAULT 'Learn More',
  cta_url TEXT NOT NULL,
  target_moments TEXT[] NOT NULL DEFAULT '{}',
  budget_cents INTEGER NOT NULL DEFAULT 2500,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'paused', 'exhausted', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMIT;