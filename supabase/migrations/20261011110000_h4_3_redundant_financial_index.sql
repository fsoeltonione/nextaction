-- H4.3: remove a redundant settlement lookup index.
-- Both retained unique indexes start with settlement_id, so they support
-- settlement_id equality queries and the FK's delete-check; this standalone
-- non-unique index duplicates storage and write maintenance.

BEGIN;
DROP INDEX IF EXISTS private.financial_entries_settlement_idx;
COMMIT;
