# Product scanner DNS-rebinding audit

**Audit date:** 2026-10-11  
**Audited source:** \`master\` at \`9879cdc1e20b6628e89e087c9577dbccda6fd912\`  
**Staging release:** [Release Gate #25](https://github.com/fsoeltonione/nextaction/actions/runs/38141651144)  
**Tracking issue:** [#104 — prove product-scanner egress boundary](https://github.com/fsoeltonione/nextaction/issues/104)

## Decision

**Status: PLATFORM MITIGATION ADDED TO DRAFT PR; STAGING VERIFICATION PENDING. Keep issue #104 open until the flag is deployed to staging and the release gate passes.**

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

Three bounded staging probes were made against the public DNS rebinding test service; no production endpoint was called:

1. \`https://01010101.7f000001.rbndr.us/\` returned HTTP 503 \`dns_no_address\`. That name did not provide a usable DNS answer in that attempt.
2. \`https://01010101.c0a80001.rbndr.us/\` returned HTTP 503 \`upstream_status\` once.
3. Four sequential probes to \`https://01010101.c0a80001.rbndr.us/\` returned HTTP 400 \`non_public_address\` on every attempt. These responses show the application refused DNS answers classified as non-public before proceeding with a scan.

Request IDs for the four fail-closed responses: \`b16170d5-1a1d-4b7e-83ef-73aac56f4830\`, \`7eb674f0-312b-4ac6-bf9c-0213b8f0354a\`, \`3c184285-de3c-40ec-a319-cbf838929fd2\`, \`d9a6a985-e58a-4086-8178-be4fe531c53e\`.

This demonstrates that **observed private DNS answers are rejected** in the deployed staging runtime. It does not prove the DNS answer changes specifically between pre-validation and the underlying Fetch connection, and there is no private-side canary or platform connection trace showing which IP the Fetch request actually reached. The one \`upstream_status\` response is also not evidence of a private connection. Therefore this remains a useful bounded defense-in-depth result, but the DNS-rebinding race is still **inconclusive / not proven safe**.
 
## Cloudflare platform boundary

The following official documentation matters:

- [Workers \`node:dns\`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/): DNS resolution is provided through DNS-over-HTTPS; \`lookup\`, \`lookupService\`, and \`resolve\` are not implemented. The application’s resolver result is not documented as a connection pin for a later \`fetch()\`.
- [Workers compatibility flags — `global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/): when enabled, global `fetch()` routes requests as if made on the public Internet; same-zone requests route back through the public front door instead of bypassing Cloudflare's normal protections.
- [Cloudflare's Workers binding/security explanation](https://blog.cloudflare.com/workers-environment-live-object-bindings/): Cloudflare describes global `fetch()` as limited to the public Internet, and SSRF-safe, for Workers without a separate origin server behind them.
- [Workers \`node:http\`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/): the implementation wraps \`fetch()\` and explicitly does not support the \`lookup\` or \`createConnection\` request options. This rules out the usual Node HTTP-agent \`lookup\` override as a documented way to pin a socket to a prevalidated IP inside this Worker.
- [Workers Request / \`resolveOverride\`](https://developers.cloudflare.com/workers/runtime-apis/request/): \`resolveOverride\` only takes effect when both URL hostname and override hostname are in the same Cloudflare zone. For unrelated external SaaS domains it is ignored for security reasons. It cannot serve as a general arbitrary-hostname IP pinning mechanism for this scanner.
- [Workers known issues / Fetch to IP addresses](https://developers.cloudflare.com/workers/platform/known-issues/): Worker subrequests use Cloudflare’s DNS resolver and URLs cannot be fetched directly to IP literals.
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/): Cloudflare directs HTTP requests to port 80/443 to \`fetch()\`; raw sockets are not a documented way to pin an arbitrary external HTTP/TLS destination here.

The separate application-level DNS lookup is still not a connection-time IP pin, and the `node:http` compatibility layer does not expose `lookup` or `createConnection` hooks for pinning. However, Cloudflare's compatibility-flags documentation exposes `global_fetch_strictly_public`: when enabled, global `fetch()` is routed as if the request originated on the public Internet. Cloudflare's official security explanation states that global `fetch()` from Workers without an origin server behind them can only reach the public Internet, and is SSRF-safe in that architecture. NextAction is deployed as a `workers.dev` Worker with no separate origin server behind it, and the application already rejects its known Worker hostnames before attempting a scan.

The mitigation added in this draft PR enables `global_fetch_strictly_public` for the Worker and adds a CI contract test to ensure the flag remains enabled and is not overridden by either named environment. This shifts the egress boundary from an application DNS check to the platform's public-fetch routing boundary. It must not be treated as deployed until the PR passes Quality, is merged, and a staging release gate verifies the resulting runtime/configuration.

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

1. CI must pass the new config-contract test, the full scanner regression suite, Cloudflare compatibility and build.
2. Merge only after reviewing that the global compatibility flag applies to both staging and production; its top-level placement means both environments inherit it.
3. Deploy staging only and verify the deployed Worker version plus the full staging Release Gate.
4. Repeat the controlled rebinding probes. The scanner must reject every DNS answer it observes as private/reserved; legitimate public HTTPS product pages must continue to work. Record the platform flag and its live staging version as part of the evidence.
5. Keep production deployment separate. The scanner mitigation can be deployed to production only through a separately approved production release.
6. Keep #104 open if the platform flag is absent from the deployed configuration, the runtime gate fails, or the controlled test exposes an unexpected request to a non-public destination.

A limitation remains in the observation: the public rebinding test service has no controlled private-side canary, so we cannot directly log a private connection. The rationale for the mitigation is now the documented Cloudflare public-fetch contract plus runtime validation, not a claim that our independent DNS lookup pins the socket. No production deployment or database mutation was performed.
