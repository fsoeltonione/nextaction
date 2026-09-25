-- NextAction Stage 6 advisor cleanup
-- user_id is a deprecated compatibility column retained only for migration
-- compatibility. Keep its FK indexed until the later cleanup migration removes it.

BEGIN;

CREATE INDEX IF NOT EXISTS workspaces_user_id_idx
  ON public.workspaces(user_id);

COMMIT;
