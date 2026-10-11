# Product Decision — Manual Publisher Moments, No AI or Crawling

**Date:** 2026-10-12  
**Scope:** NextAction MVP  
**Status:** Accepted

## Decision

Drop AI-based Product Understanding and publisher-site crawling from the MVP. NextAction will not fetch or crawl a publisher's submitted product URL to infer what the SaaS does, derive Moments, or generate a proposal. It will not require an LLM provider secret/model to build or release.

The URL remains a normalized publisher-provided product identity/reference field. Product name, description, and semantic Moments are entered or edited explicitly by the publisher. For example, the publisher can define a Moment key `invoice_created` with a human-readable label like “Invoice created”.

## Simple publisher integration direction

Publisher-side integration should be minimal: include one browser script and call an explicit function at the desired UI action, conceptually:

```html
<script src="https://cdn.nextaction.click/nextaction.js"
        data-publisher-key="pub_example"
        defer></script>
```

```javascript
function invoice_created() {
  show_ads("invoice_created");
}
```

The snippet above is an illustrative target contract, not a currently deployed CDN file/API. Before enabling it, design a browser-safe public publisher identifier and server-side authorization/abuse controls. Never expose the current `na_live_` integration credential or any Supabase service-role secret in browser code. The current authenticated server-side `/v1/offer` route is not by itself a drop-in public browser API.

## Unchanged business domain

The canonical chain remains:

```
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
```

The existing qualification policy, idempotency, delivery token, click processing, settlement allocation, and financial ledger remain in scope. Removing AI/crawling is not permission to weaken those controls.

## Implementation consequences

- Remove `POST /api/analyze`, the product scanner, AI provider parsing/output code, provider secrets/model configuration, crawler/runtime probe endpoints, scanner-specific tests, and scanner-specific release jobs.
- Keep local URL syntax/host normalization. It must not resolve DNS, fetch the URL, load external favicons, or follow redirects.
- Keep authenticated `POST /api/products/confirm` as the persistence boundary.
- Update onboarding to start with the publisher URL and a blank editable Product/Moment form.
- Update anonymous acceptance to prove manual entry and HTTP 401 before persistence, not AI proposal generation.
- Preserve existing Event → Moment processing, contextual decisioning, click qualification, and settlement tests.
- Do not deploy to production as part of this code change. Deploy through the standard staged release process after merge.

## Out of scope for this change

This decision does not claim that the new `show_ads()` integration is already implemented. A separate follow-up must design and test the browser script delivery, publisher-key/origin policy, public offer retrieval contract, and click/settlement safety without placing secrets in the browser.

It also does not close the historical DNS-rebinding issue until the old scanner is absent from the deployed environments and release evidence confirms the intended behavior.
