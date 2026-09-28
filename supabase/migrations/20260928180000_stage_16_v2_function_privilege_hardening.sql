-- Stage 16 hardening: v2 activation RPCs are authenticated-only.
--
-- The project has explicit default EXECUTE grants to anon for functions in
-- public. REVOKE FROM PUBLIC alone does not remove a direct anon grant, so
-- each Stage 16 v2 function must explicitly revoke anon.
BEGIN;

REVOKE ALL ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities_v2(UUID, TEXT[]) TO authenticated;

REVOKE ALL ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offer_activation_v2(UUID, TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;

COMMIT;
