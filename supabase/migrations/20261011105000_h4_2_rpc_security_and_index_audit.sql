-- H4.2: preserve the existing authenticated RPC contracts while moving
-- SECURITY DEFINER implementations out of the exposed public schema.
-- The internal bodies retain their auth.uid()/workspace-membership guards.
-- Public endpoints become SECURITY INVOKER adapters; grants remain explicit.
-- Also remove the full event_id index, which duplicates the partial unique
-- index used for every non-NULL event_id lookup.

BEGIN;

GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Move the original, membership-checked implementations out of public.
ALTER FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  SET SCHEMA private;
ALTER FUNCTION private.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  RENAME TO _activation_confirm_product_v2_impl;
ALTER FUNCTION private._activation_confirm_product_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  SET search_path = '';

ALTER FUNCTION public.create_network_offer_activation_v1(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  SET SCHEMA private;
ALTER FUNCTION private.create_network_offer_activation_v1(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  RENAME TO _activation_create_network_offer_v1_impl;
ALTER FUNCTION private._activation_create_network_offer_v1_impl(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  SET search_path = '';

ALTER FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  SET SCHEMA private;
ALTER FUNCTION private.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  RENAME TO _activation_create_offer_v2_impl;
ALTER FUNCTION private._activation_create_offer_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  SET search_path = '';

ALTER FUNCTION public.set_moment_network_mapping_v1(UUID, TEXT)
  SET SCHEMA private;
ALTER FUNCTION private.set_moment_network_mapping_v1(UUID, TEXT)
  RENAME TO _activation_set_moment_network_mapping_v1_impl;
ALTER FUNCTION private._activation_set_moment_network_mapping_v1_impl(UUID, TEXT)
  SET search_path = '';

ALTER FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[])
  SET SCHEMA private;
ALTER FUNCTION private.set_workspace_capabilities_v2(UUID, TEXT[])
  RENAME TO _activation_set_workspace_capabilities_v2_impl;
ALTER FUNCTION private._activation_set_workspace_capabilities_v2_impl(UUID, TEXT[])
  SET search_path = '';

-- Keep the public RPC names, parameter names, defaults and return shapes stable.
-- These wrappers execute with caller privileges and delegate only to the
-- private implementation that independently authenticates and scopes access.
CREATE OR REPLACE FUNCTION public.confirm_product_activation_v2(
  p_workspace_id UUID,
  p_canonical_url TEXT,
  p_domain TEXT,
  p_name TEXT,
  p_description TEXT,
  p_moments JSONB
)
RETURNS TABLE (workspace_id UUID, product_id UUID, moment_count INTEGER)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $wrapper$
  SELECT * FROM private._activation_confirm_product_v2_impl($1, $2, $3, $4, $5, $6);
$wrapper$;

CREATE OR REPLACE FUNCTION public.create_network_offer_activation_v1(
  p_workspace_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_network_moment_keys TEXT[]
)
RETURNS TABLE (workspace_id UUID, offer_id UUID, network_moment_count INTEGER)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $wrapper$
  SELECT * FROM private._activation_create_network_offer_v1_impl($1, $2, $3, $4, $5, $6);
$wrapper$;

CREATE OR REPLACE FUNCTION public.create_offer_activation_v2(
  p_workspace_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_cta_label TEXT,
  p_destination_url TEXT,
  p_moment_ids UUID[]
)
RETURNS TABLE (workspace_id UUID, offer_id UUID, moment_count INTEGER)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $wrapper$
  SELECT * FROM private._activation_create_offer_v2_impl($1, $2, $3, $4, $5, $6);
$wrapper$;

CREATE OR REPLACE FUNCTION public.set_moment_network_mapping_v1(
  p_moment_id UUID,
  p_network_moment_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  result_moment_id UUID,
  result_network_moment_id UUID,
  result_network_moment_key TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $wrapper$
  SELECT * FROM private._activation_set_moment_network_mapping_v1_impl($1, $2);
$wrapper$;

CREATE OR REPLACE FUNCTION public.set_workspace_capabilities_v2(
  p_workspace_id UUID,
  p_capabilities TEXT[]
)
RETURNS TABLE (workspace_id UUID, capability TEXT)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $wrapper$
  SELECT * FROM private._activation_set_workspace_capabilities_v2_impl($1, $2);
$wrapper$;

-- The five privileged helpers are callable only by signed-in callers through
-- the membership-checked functions above; they remain outside the exposed API.
REVOKE ALL ON FUNCTION private._activation_confirm_product_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private._activation_confirm_product_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private._activation_create_network_offer_v1_impl(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private._activation_create_network_offer_v1_impl(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private._activation_create_offer_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private._activation_create_offer_v2_impl(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private._activation_set_moment_network_mapping_v1_impl(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private._activation_set_moment_network_mapping_v1_impl(UUID, TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private._activation_set_workspace_capabilities_v2_impl(UUID, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private._activation_set_workspace_capabilities_v2_impl(UUID, TEXT[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_network_offer_activation_v1(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_network_offer_activation_v1(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_moment_network_mapping_v1(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_moment_network_mapping_v1(UUID, TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[])
  TO authenticated, service_role;

-- The partial unique index on (event_id) WHERE event_id IS NOT NULL covers
-- event_id equality checks and the Event FK's ON DELETE SET NULL lookup.
DROP INDEX IF EXISTS private.moment_occurrences_event_id_idx;

COMMIT;
