-- H1 follow-up: explicit deny policy for the private monitoring table.
BEGIN;

DROP POLICY IF EXISTS runtime_integrity_snapshots_no_access
  ON private.runtime_integrity_snapshots;

CREATE POLICY runtime_integrity_snapshots_no_access
  ON private.runtime_integrity_snapshots
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
