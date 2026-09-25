-- NextAction Stage 8 security hardening.
-- Remove explicit anonymous execution grants that survived the earlier PUBLIC revoke.
BEGIN;
REVOKE ALL ON FUNCTION public.confirm_product_activation(TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_workspace_capabilities(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_activation(TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) TO authenticated;
COMMIT;