-- NextAction Stage 8 function grant hardening
-- Keep activation RPCs executable only by authenticated application users
-- (plus PostgreSQL owner/service_role operational access).
BEGIN;

REVOKE ALL ON FUNCTION public.confirm_product_activation(TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_workspace_capabilities(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_product_activation(TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_capabilities(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_offer_activation(TEXT,TEXT,TEXT,TEXT,UUID[]) TO authenticated;

COMMIT;
