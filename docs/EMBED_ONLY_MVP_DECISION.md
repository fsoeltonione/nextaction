# NextAction Embed-Only MVP Decision

## Decision

The MVP does not crawl publisher URLs and does not use AI to infer Moments.

A publisher explicitly declares the commercial Moment in its own application code and calls:

```js
show_ads("invoice_created");
```

The publisher installs one plain JavaScript file. There is no SDK/package installation.

## Publisher integration

```html
<script
  src="https://YOUR-NEXTACTION-HOST/nextaction.js"
  data-publisher-key="PUBLIC_PUBLISHER_KEY"
  defer
></script>
```

Then, at the desired application action:

```js
invoice_created();
// or directly:
show_ads("invoice_created");
```

The public publisher key identifies the integration. It is not an administrative secret and cannot provision or mutate resources.

## Runtime path

`show_ads(moment_key)` → `/v1/public-offer` → deterministic decision RPC → delivery token → click endpoint → Qualified Click → Settlement.

The browser embed never receives an integration secret. The delivery token is short-lived and is only useful for the specific delivery/click path.

## Explicitly removed from the critical path

- Product URL crawling
- Product page scraping
- AI product analysis
- AI-generated Moment discovery
- SDK/package installation

The legacy `/api/analyze` route now returns HTTP 410 and does not crawl or call an AI provider. It is retained temporarily as a fail-closed compatibility surface so stale clients cannot accidentally invoke the old behavior.

## Security model

Advertising is best-effort from the publisher's perspective. If NextAction is unavailable, rate-limited, or has no fill, `show_ads()` resolves without breaking the publisher's primary application action.

Settlement remains server-side through the existing delivery-token and database RPC path. The browser does not get authority to declare a Qualified Click or settlement amount.

## Follow-up cleanup

The old scanner implementation and its dedicated CI contracts are now obsolete because nothing in the activation or runtime path invokes them. They should be removed in a follow-up cleanup after the legacy CI contract jobs are retired. Do not reintroduce URL crawling merely to satisfy those historical tests.
