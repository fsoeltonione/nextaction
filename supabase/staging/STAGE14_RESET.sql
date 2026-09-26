BEGIN;

-- Staging is disposable. Immutable-history triggers are disabled only inside
-- this reset transaction so fixture cleanup can remove prior smoke records.
ALTER TABLE private.financial_entries DISABLE TRIGGER trg_financial_entries_immutable;
ALTER TABLE private.advertiser_credit_entries DISABLE TRIGGER trg_advertiser_credit_entries_immutable;
ALTER TABLE private.settlements DISABLE TRIGGER trg_settlements_immutable;
ALTER TABLE private.qualified_clicks DISABLE TRIGGER trg_qualified_clicks_immutable;

DELETE FROM private.financial_entries
WHERE settlement_id IN (
  SELECT id
  FROM private.settlements
  WHERE advertiser_workspace_id IN (
    SELECT id FROM public.workspaces
    WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
  )
  OR publisher_workspace_id IN (
    SELECT id FROM public.workspaces
    WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
  )
);

DELETE FROM private.advertiser_credit_entries
WHERE workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM private.settlements
WHERE advertiser_workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
)
OR publisher_workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM private.qualified_clicks
WHERE click_id IN (
  SELECT c.id
  FROM private.clicks c
  JOIN private.deliveries d ON d.id = c.delivery_id
  WHERE d.offer_id IN (
    SELECT id FROM public.offers WHERE title = 'Stage 14 Smoke Offer'
  )
);

DELETE FROM private.clicks
WHERE delivery_id IN (
  SELECT id FROM private.deliveries
  WHERE offer_id IN (
    SELECT id FROM public.offers WHERE title = 'Stage 14 Smoke Offer'
  )
);

DELETE FROM private.deliveries
WHERE offer_id IN (
  SELECT id FROM public.offers WHERE title = 'Stage 14 Smoke Offer'
);

DELETE FROM private.decisions
WHERE offer_id IN (
  SELECT id FROM public.offers WHERE title = 'Stage 14 Smoke Offer'
);

DELETE FROM private.moment_occurrences
WHERE integration_id IN (
  SELECT id FROM public.integrations
  WHERE name = 'stage14-smoke-integration'
);

DELETE FROM private.events
WHERE integration_id IN (
  SELECT id FROM public.integrations
  WHERE name = 'stage14-smoke-integration'
);

DELETE FROM private.rate_limit_buckets
WHERE scope IN ('runtime:track:auth', 'runtime:track', 'runtime:offer:auth', 'runtime:offer', 'runtime:click:ip');

DELETE FROM private.advertiser_credit_accounts
WHERE workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM private.integration_secrets
WHERE integration_id IN (
  SELECT id FROM public.integrations
  WHERE name = 'stage14-smoke-integration'
);

DELETE FROM private.financial_accounts
WHERE workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM public.offer_moments
WHERE offer_id IN (
  SELECT id FROM public.offers WHERE title = 'Stage 14 Smoke Offer'
);

DELETE FROM public.offers
WHERE title = 'Stage 14 Smoke Offer';

DELETE FROM public.integrations
WHERE name = 'stage14-smoke-integration';

DELETE FROM public.moments
WHERE moment_key = 'stage14_smoke_moment';

DELETE FROM public.products
WHERE name = 'Stage 14 Publisher';

DELETE FROM public.workspace_capabilities
WHERE workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM public.workspace_members
WHERE workspace_id IN (
  SELECT id FROM public.workspaces
  WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser')
);

DELETE FROM public.workspaces
WHERE name IN ('Stage 14 Publisher', 'Stage 14 Advertiser');

ALTER TABLE private.financial_entries ENABLE TRIGGER trg_financial_entries_immutable;
ALTER TABLE private.advertiser_credit_entries ENABLE TRIGGER trg_advertiser_credit_entries_immutable;
ALTER TABLE private.settlements ENABLE TRIGGER trg_settlements_immutable;
ALTER TABLE private.qualified_clicks ENABLE TRIGGER trg_qualified_clicks_immutable;

COMMIT;