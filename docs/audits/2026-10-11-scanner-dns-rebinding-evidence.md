# Product scanner DNS-rebinding audit

**Audit date:** 2026-10-11  
**Audited source:** \`master\` at \`9879cdc1e20b6628e89e087c9577dbccda6fd912\`  
**Staging release:** [Release Gate #25](https://github.com/fsoeltonione/nextaction/actions/runs/38141651144)  
**Tracking issue:** [#104 — prove product-scanner egress boundary](https://github.com/fsoeltonione/nextaction/issues/104)

## Decision

**Status: NOT PROVEN. Keep issue #104 open. Do not describe the current scanner as proven resistant to DNS rebinding.**

The existing safeguards are useful defense-in-depth, but neither the unit tests nor the current staging smoke can prove which destination IP the Cloudflare Fetch implementation connects to after an application-level DNS lookup.

## What the current code and tests establish

- IPv4/IPv6 checks reject the blocked/reserved ranges represented in \`src/lib/ip-address.ts\`.
- The scanner rejects empty DNS results and fails closed if its own DNS lookup observes any non-public answer.
- Known NextAction production/staging Worker origins are rejected before resolution/fetch.
- Redirects are manual and each redirect target is validated independently.
- The scanner resolves the hostname again after a response and rejects an observed private answer.
- \`scripts/product-scanner-security-test.ts\` tests a mocked resolver that changes from public to private. That unit test proves the application reacts to the mock result; its fetch is also mocked, so it does not observe the actual network destination.

The successful staging smoke in Release Gate #25 exercised the two known self-origin rejections. It did **not** exercise DNS rebinding.

## Controlled runtime attempt

A one-off request was sent to staging \`POST /api/analyze\` with:

\`\`\`text
https://01010101.7f000001.rbndr.us/
\`\`\`

The staging route returned HTTP 503 with \`dns_no_address\` and message “Product host did not resolve to a usable address.” The selected rebinding hostname did not provide a usable DNS answer during this attempt, so this was **inconclusive**, not a successful rebinding reproduction and not a security pass. A separate DNS-over-HTTPS check of a different \`rbndr.us\` hostname showed a private answer, but that answer was not used in a successful staging fetch and therefore is not proof of what the Worker connected to.

## Cloudflare platform boundary

The following official documentation matters:

- [Workers \`node:dns\`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/): DNS resolution is provided through DNS-over-HTTPS; \`lookup\`, \`lookupService\`, and \`resolve\` are not implemented. The application’s resolver result is not documented as a connection pin for a later \`fetch()\`.
- [Workers Request / \`resolveOverride\`](https://developers.cloudflare.com/workers/runtime-apis/request/): \`resolveOverride\` only takes effect when both URL hostname and override hostname are in the same Cloudflare zone. For unrelated external SaaS domains it is ignored for security reasons. It cannot serve as a general arbitrary-hostname IP pinning mechanism for this scanner.
- [Workers known issues / Fetch to IP addresses](https://developers.cloudflare.com/workers/platform/known-issues/): Worker subrequests use Cloudflare’s DNS resolver and URLs cannot be fetched directly to IP literals.
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/): Cloudflare directs HTTP requests to port 80/443 to \`fetch()\`; raw sockets are not a documented way to pin an arbitrary external HTTP/TLS destination here.

These documents do not provide an authoritative guarantee that the IP validated by this application’s separate DNS query is the same IP used by the later hostname-based Fetch connection. They also do not prove that every private destination reached through DNS rebinding is blocked. We should not infer either guarantee from the platform description alone.

## Required path to close the issue

The durable mitigation needs a fetch boundary that can enforce all of these properties together:

1. Resolve the destination and validate every A/AAAA answer.
2. Connect to one of the validated public IPs without doing a second unpinned hostname lookup.
3. For HTTPS, preserve the original hostname for SNI and certificate/hostname verification; never disable TLS verification.
4. Repeat the full validation/pinning procedure for every redirect.
5. Enforce timeouts, response-size/content-type limits, and deny private/reserved destinations at the connection boundary.
6. Provide an observable controlled test with a canary target, proving that the private-side canary never receives a request while legitimate public HTTPS URLs and valid certificates continue to work.

The current Cloudflare Worker Fetch API does not expose the necessary general arbitrary-hostname IP pinning control in the reviewed documented interfaces. A dedicated egress/fetch service with a verified connect-time pinning contract is therefore the preferred next architecture decision. If such a service is not provisioned, disabling arbitrary URL scanning is safer than claiming the gap has been closed, but it would affect product functionality.

## Acceptance gate

Do not close #104 until the connect-time behavior is independently observable or the egress boundary is moved to a runtime/service that can enforce the required contract, followed by regression tests, Cloudflare compatibility/build, and a staging Release Gate. No production deployment or database mutation was performed as part of this audit.
