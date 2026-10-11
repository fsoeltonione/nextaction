# Product scanner egress boundary

## Decision

Use Cloudflare Workers' documented public-Internet egress path for all global `fetch()` calls. The scanner still validates A and AAAA answers before each request, fails closed if any answer is private/reserved, validates the result after the request, and follows redirects manually with the same checks on every hop. Those DNS checks are defense in depth; they do not bind the platform's connection-time DNS lookup to the earlier DNS-over-HTTPS result.

The top-level Wrangler configuration explicitly enables `global_fetch_strictly_public`. This applies to staging and production unless overridden by a per-environment compatibility flag; neither environment defines a compatibility override. Do not add `global_fetch_private_origin`.

## Platform evidence

- Cloudflare's [compatibility-flags documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public) says `global_fetch_strictly_public` makes global `fetch()` route requests as if made on the public Internet. Without it, requests to the Worker's own zone can be routed directly to the origin and bypass Cloudflare security settings.
- Cloudflare's [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/) describes a proxy-mediated outbound HTTP path that restricts requests to public Internet services or the Worker's zone origin, rather than internal services. With the strict-public flag enabled, this Worker opts out of the zone-origin route.
- The [Node.js DNS compatibility documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) states `node:dns` resolution uses DNS-over-HTTPS via Cloudflare DNS at 1.1.1.1. This lookup is not a connection pin for global `fetch()`; application-side preflight and postflight lookups alone cannot remove the time-of-check/time-of-use gap.

The security boundary therefore relies on both application validation and the platform's documented strict-public egress policy. We do **not** claim that preflight and postflight DNS lookups pin a socket to one resolved IP, nor do we introduce raw TCP/TLS handling that would risk breaking HTTPS certificate and hostname validation.

## Verification contract

- `npm run test:scanner` tests the scanner's fail-closed DNS policy, redirect validation, rebinding simulations, and no-fetch behavior when DNS returns a prohibited address.
- `npm run test:cloudflare-fetch-policy` asserts that Wrangler enables strict-public global fetch and that the opposite compatibility flag is not enabled in either environment.
- Release Gate's staging smoke verifies the actual staging release provenance, scanner live path, and pre-fetch rejection of NextAction's own staging and production Worker origins.
- The strict-public configuration must be present in the deployed staging version before marking the platform mitigation verified. A successful self-origin rejection alone is not a DNS-rebinding proof; it is only one component of the evidence.

## Operational guardrails

Do not dispatch the production release for this work. Test the configuration in staging first. If platform behavior changes or Cloudflare can no longer support the stated public-egress boundary, keep scanner URL analysis disabled for untrusted arbitrary hosts until a compatible, TLS-validating egress proxy or IP-pinned transport is available.
