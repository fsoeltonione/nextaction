-- Stage 16: keep generic placeholder Moment identifiers out of canonical Product data.
-- This is a storage-boundary invariant, not only a UI validation rule.
BEGIN;

CREATE OR REPLACE FUNCTION private.guard_moment_key_semantics()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF NEW.moment_key IS NULL
     OR NEW.moment_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
     OR length(NEW.moment_key) > 100
     OR NEW.moment_key IN ('new', 'temp', 'thing', 'foo')
     OR NEW.moment_key ~ '^(moment|new_moment|new)_[0-9]+$'
  THEN
    RAISE EXCEPTION 'Moment key must be meaningful lower_snake_case; generic placeholder keys are not allowed'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_moment_key_semantics() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS moments_semantic_key_guard ON public.moments;
CREATE TRIGGER moments_semantic_key_guard
BEFORE INSERT OR UPDATE OF moment_key ON public.moments
FOR EACH ROW
EXECUTE FUNCTION private.guard_moment_key_semantics();

COMMIT;
