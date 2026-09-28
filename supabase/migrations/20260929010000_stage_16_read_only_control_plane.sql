-- NextAction Stage 16 hardening: authenticated control-plane is read-only.
--
-- Browser clients may read workspace/product/capability/integration/offer state,
-- but all mutations must pass through the authenticated activation API/RPC
-- boundaries. The v2 wrappers are SECURITY DEFINER so their internal atomic
-- writes remain possible after direct table mutation privileges are removed.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Privileged mutation boundary
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.confirm_product_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) SECURITY DEFINER;

ALTER FUNCTION public.confirm_product_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.set_workspace_capabilities_v2(
  UUID, TEXT[]
) SECURITY DEFINER;

ALTER FUNCTION public.set_workspace_capabilities_v2(
  UUID, TEXT[]
) SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.create_offer_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID[]
) SECURITY DEFINER;

ALTER FUNCTION public.create_offer_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID[]
) SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.confirm_product_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.confirm_product_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_workspace_capabilities_v2(
  UUID, TEXT[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities_v2(
  UUID, TEXT[]
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_offer_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_offer_activation_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID[]
) TO authenticated, service_role;

-- Legacy mutation functions remain internal implementation helpers only.
ALTER FUNCTION public.confirm_product_activation(
  TEXT, TEXT, TEXT, TEXT, JSONB
) SECURITY DEFINER;

ALTER FUNCTION public.confirm_product_activation(
  TEXT, TEXT, TEXT, TEXT, JSONB
) SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.set_workspace_capabilities(
  TEXT[]
) SECURITY DEFINER;

ALTER FUNCTION public.set_workspace_capabilities(
  TEXT[]
) SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.create_offer_activation(
  TEXT, TEXT, TEXT, TEXT, UUID[]
) SECURITY DEFINER;

ALTER FUNCTION public.create_offer_activation(
  TEXT, TEXT, TEXT, TEXT, UUID[]
) SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.confirm_product_activation(
  TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_product_activation(
  TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.set_workspace_capabilities(
  TEXT[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities(
  TEXT[]
) TO service_role;

REVOKE ALL ON FUNCTION public.create_offer_activation(
  TEXT, TEXT, TEXT, TEXT, UUID[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_offer_activation(
  TEXT, TEXT, TEXT, TEXT, UUID[]
) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Authenticated control-plane is read-only
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workspace_capabilities,
  public.products,
  public.moments,
  public.integrations,
  public.offers,
  public.offer_moments
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workspace_capabilities,
  public.products,
  public.moments,
  public.integrations,
  public.offers,
  public.offer_moments
TO authenticated;

-- Service role remains the only direct table mutation principal.
GRANT ALL PRIVILEGES ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workspace_capabilities,
  public.products,
  public.moments,
  public.integrations,
  public.offers,
  public.offer_moments
TO service_role;

COMMIT;
