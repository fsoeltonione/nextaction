-- Stage 16 hardening: make intentionally private tables' deny-by-default
-- RLS state explicit for the database advisor.
--
-- These tables live in the private schema and are not granted to anon or
-- authenticated. The policy documents that API roles must never reach them.
BEGIN;

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.advertiser_credit_accounts;
CREATE POLICY "private_table_deny_api_roles"
ON private.advertiser_credit_accounts
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.advertiser_credit_entries;
CREATE POLICY "private_table_deny_api_roles"
ON private.advertiser_credit_entries
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.clicks;
CREATE POLICY "private_table_deny_api_roles"
ON private.clicks
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.decisions;
CREATE POLICY "private_table_deny_api_roles"
ON private.decisions
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.deliveries;
CREATE POLICY "private_table_deny_api_roles"
ON private.deliveries
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.events;
CREATE POLICY "private_table_deny_api_roles"
ON private.events
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.financial_accounts;
CREATE POLICY "private_table_deny_api_roles"
ON private.financial_accounts
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.financial_entries;
CREATE POLICY "private_table_deny_api_roles"
ON private.financial_entries
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.integration_secrets;
CREATE POLICY "private_table_deny_api_roles"
ON private.integration_secrets
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.moment_occurrences;
CREATE POLICY "private_table_deny_api_roles"
ON private.moment_occurrences
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.qualified_clicks;
CREATE POLICY "private_table_deny_api_roles"
ON private.qualified_clicks
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.rate_limit_buckets;
CREATE POLICY "private_table_deny_api_roles"
ON private.rate_limit_buckets
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "private_table_deny_api_roles" ON private.settlements;
CREATE POLICY "private_table_deny_api_roles"
ON private.settlements
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

COMMIT;
