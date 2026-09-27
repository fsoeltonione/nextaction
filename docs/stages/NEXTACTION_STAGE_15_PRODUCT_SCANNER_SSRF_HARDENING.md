# NextAction Stage 15 — DNS-aware Product Scanner / SSRF Hardening

**Status:** FULLY COMPLETED and merged after green quality, scanner-security, Cloudflare-compatibility, and Cloudflare-build gates.
**Date:** 2026-09-27
**Baseline:** Stage 14 release-gated master

## 1. Objective

Stage 15 hardens the public Product Analysis trust boundary before NextAction uses remote SaaS pages as model context.

The scanner treats the supplied URL and the retrieved page as untrusted input.

The locked product/domain contract is unchanged:

Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement

## 2. Security requirements

The scanner enforces:

- HTTP/HTTPS only;
- no embedded URL credentials;
- public hostname required;
- raw IP-literal targets rejected;
- only ports 80 and 443;
- A and AAAA DNS validation;
- non-public/reserved IP rejection;
- DNS failure rejection;
- maximum 3 redirects;
- manual redirect handling;
- redirect re-validation;
- HTTPS-to-HTTP downgrade rejection;
- redirect-loop detection;
- 8 second fetch timeout;
- 256 KiB response limit;
- early Content-Length rejection;
- HTML/XHTML content-type allowlist;
- no caller Authorization/Cookie/arbitrary-header forwarding;
- bounded title/meta/text extraction;
- anonymous analysis rate limit of 10 requests/minute per request-IP subject;
- structured scanner errors.

## 3. DNS policy

IPv4 and IPv6 addresses are classified with a dedicated implementation rather than hostname-prefix heuristics.

The policy rejects loopback, private, link-local, multicast, unspecified, documentation, benchmark/reserved, carrier-grade NAT, IPv4-mapped private IPv6, and other non-public ranges represented by the scanner's blocked CIDR set.

A domain is rejected when any returned A or AAAA address is non-public.

## 4. Redirect policy

Redirects use manual mode.

The Location header is parsed relative to the current URL and passed through the same URL/DNS policy before the next request.

The scanner rejects:

- redirect targets containing credentials;
- IP-literal targets;
- disallowed ports;
- non-public DNS answers;
- HTTPS-to-HTTP downgrade;
- redirect loops;
- more than three redirects.

This is deliberate because Cloudflare Workers documents that automatic redirect following can forward sensitive headers to a different host. Manual redirects ensure the scanner controls the next request's headers. Cloudflare also documents that Worker fetches cannot directly target IP-address URLs, reinforcing the hostname-only scanner policy.

## 5. Resource controls

The scanner applies:

- 8 second per-request timeout;
- 256 KiB decoded response-body limit;
- Content-Length early rejection when supplied;
- HTML/XHTML-only content;
- bounded extracted text of 16,000 characters.

Oversized bodies are cancelled rather than fully buffered.

## 6. Page-context trust boundary

The extracted page snapshot is sent to the analysis provider only as untrusted data.

The analysis prompt explicitly instructs the model to ignore instructions, commands, prompts, or policy claims present inside the retrieved web content.

The browser receives only the structured product analysis. DNS answers and scanner internals are not exposed to the caller.

## 7. DNS TOCTOU limitation

Cloudflare Workers provides DNS resolution through node:dns over DNS-over-HTTPS, but ordinary Worker fetch does not expose a general connection-pinning primitive for arbitrary public hostnames.

Therefore this stage does **not** claim perfect connection-level DNS pinning.

The implementation:

1. resolves and validates the hostname before fetch;
2. performs the request with manual redirects;
3. resolves and validates the same hostname again after the response;
4. repeats full validation for every redirect target.

This detects an observed transition to a non-public DNS answer and materially narrows the attack surface, but it cannot mathematically eliminate a race occurring between validation and Cloudflare's own egress resolution.

If strict connection-to-resolved-IP pinning becomes a requirement, a separate egress architecture is required. The scanner must not silently describe the current implementation as true DNS pinning.

## 8. Abuse controls

Product analysis is available before authentication, so it is rate-limited through the existing server-side rate-limit service:

runtime:analyze:ip
10 requests / minute / request-IP subject

Rate-limit service failure is fail-closed.

No new database table is required for this stage because the existing rate-limit bucket mechanism is scope-based.

## 9. Verification

The Stage 15 security suite covers:

- public IPv4 acceptance;
- private/reserved IPv4 rejection;
- IPv6 rejection/acceptance cases;
- IPv4-mapped IPv6 handling;
- IP-literal rejection;
- DNS failure rejection before fetch;
- private DNS rejection before fetch;
- embedded-credential and unsupported-port rejection;
- fetch timeout;
- streaming response-size enforcement;
- manual redirects;
- header isolation;
- HTTPS downgrade rejection;
- private redirect target rejection;
- redirect targets containing credentials;
- unsupported content-type rejection;
- Content-Length response-size rejection;
- redirect-limit enforcement;
- real redirect-loop detection.

The tests do not depend on the public network.

## 10. Live staging verification

The staging smoke now exercises `POST /api/analyze` through the deployed Worker in addition to the existing runtime chain.

The staging and production deployment contexts must provide `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`. The deployment script stores the API key as a Worker secret and injects the base URL and model as Worker variables. Release deployment validation fails before deployment when these values are absent.

The analyze smoke validates:

- the deployed endpoint returns HTTP 200;
- the response contains a structured `analysis` object;
- product name and description are non-empty;
- the returned Moment list contains 1 to 10 items.

The fixture defaults to `https://example.com` and may be overridden by the controlled `STAGING_ANALYZE_SMOKE_URL` environment variable.

This smoke validates the deployed scanner/analyzer path without asserting fragile LLM content.

## 11. CI gate

A dedicated CircleCI product_scanner_security job runs the Stage 15 suite.

The workflow now requires:

quality
  ->
product_scanner_security
  ->
cloudflare_compatibility
  ->
cloudflare_build

The same dependency is applied to the opt-in release gate.

## 12. Exit criteria

Stage 15 was merged after the following exit criteria were satisfied:

- scanner implementation is present;
- DNS/IP checks are tested;
- redirects are manually controlled and revalidated;
- request/response limits are enforced;
- arbitrary caller credentials are not forwarded;
- analysis receives bounded untrusted content;
- anonymous analysis is rate-limited;
- security suite is green;
- normal quality CI is green;
- Cloudflare compatibility and build checks are green;
- the DNS TOCTOU limitation is explicitly documented.

The next milestone is Stage 16 — Activation Flow v2 Completion.


## 11.1 Final verification

Merged Stage 15 commit: `d7d3f5260c2d50ef09334397c08c2651318d961d`

Final post-merge CI gates were green:
- `quality`
- `product_scanner_security`
- `cloudflare_compatibility`
- `cloudflare_build`

## 13. External references used

OWASP SSRF Prevention Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

Cloudflare Workers DNS:
https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/

Cloudflare Workers Request / redirect behavior:
https://developers.cloudflare.com/workers/runtime-apis/request/

Cloudflare Workers known issues / IP-address fetch restriction:
https://developers.cloudflare.com/workers/platform/known-issues/
