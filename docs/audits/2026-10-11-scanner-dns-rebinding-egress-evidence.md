# Product scanner DNS-rebinding / egress-boundary evidence — 2026-10-11

## Decision

The scanner has layered protection, and the Cloudflare Workers platform documents an outbound proxy boundary that restricts requests to public Internet services or the Worker's own-zone origin rather than internal services. This is strong vendor evidence for the **internal-network SSRF boundary**, even if a hostname's DNS answer changes after the application preflight.

However, Cloudflare's public documentation reviewed for this audit does **not explicitly specify the DNS resolution / destination-IP check ordering at the exact connection-establishment point for a DNS-rebinding request**. The existing Release Gate staging smoke tests self-origin rejection, not a live DNS-rebinding hostname against an instrumented private sink. Therefore this report does not claim that the scanner pins a socket to the prevalidated IP, and Issue #104 should stay open until the runtime behavior is directly demonstrated or Cloudflare confirms this specific guarantee in writing.

## Source code controls found in `master`

- `src/lib/product-scanner.ts` resolves A and AAAA records and fails closed if DNS yields no addresses or any disallowed/private/reserved address.
- Each redirect is handled manually; the next URL is normalized and revalidated before the next request. HTTPS-to-HTTP downgrade and forbidden targets are rejected.
- A post-fetch resolution is also performed. This can detect an observed rebind after a request, but **does not prove which address was used for the request already in flight**.
- `scripts/product-scanner-security-test.ts` contains regression tests for a public-then-private resolver answer, private DNS answer before fetch (zero fetches), and redirect validation.
- `scripts/staging-scanner-security-smoke.mjs` verifies that staging and production NextAction Worker self-origins are rejected before fetch. Release Gate run #25 passed this test and the normal scanner live-path smoke.

## Cloudflare platform documentation reviewed

1. Workers Security Model: https://developers.cloudflare.com/workers/reference/security-model/

   The documented architecture routes all outbound HTTP requests through a local proxy. That proxy restricts requests to a public Internet service or the Worker's own-zone origin, not internal services visible on the local machine/network. This is the platform-level egress boundary on which the protection against internal-network SSRF depends.

2. Workers Node.js DNS: https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/

   `node:dns` resolution uses DNS-over-HTTPS through Cloudflare DNS (1.1.1.1). That resolver result is application data; it does not pin the independent `fetch()` connection to the same IP.

3. Workers Fetch known issues — Fetch to IP addresses: https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses

   Workers subrequests are made to URLs rather than IP-literal URLs. This prevents a simple `fetch('https://<validated-ip>')` pinning implementation.

4. Workers Request — `resolveOverride`: https://developers.cloudflare.com/workers/runtime-apis/request/#resolveoverride

   `resolveOverride` is only honored when both the URL host and override hostname are in the same zone; it is not a general-purpose override for arbitrary third-party product URLs.

5. Workers TCP sockets: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

   Outbound TCP sockets to Cloudflare IP ranges are blocked. Replacing generic `fetch()` with direct IP-pinned HTTP/TLS sockets is therefore not a safe universal fix for a scanner that must keep working with public products hosted behind Cloudflare; it would require broader transport design and fallback rules.

## Supported-runtime conclusion

The relevant security claim is **not** “the application has pinned the hostname to the exact IP it prevalidated.” It has not. The claim supported by current source and vendor docs is:

- App-layer validation fails closed on observed private/reserved DNS answers and manually revalidates redirect targets.
- Actual outbound HTTP is mediated by the Workers proxy, whose documented egress policy excludes internal services.
- The application's behavior therefore relies on Cloudflare's egress enforcement as a second boundary if DNS changes between the app-level validation and `fetch()`.

This vendor documentation materially supports the protection but is not a DNS-rebinding-specific connection-timing guarantee. No arbitrary internal service was probed, no production Worker was deployed, and no database was changed during this audit.

## Evidence required to close Issue #104

- Either obtain written Cloudflare confirmation that the outbound proxy rejects a hostname when it resolves to private/reserved space at connection time, including under DNS rebinding; or run a controlled, authorized staging runtime test with a rebinding hostname and an instrumented test sink that proves no prohibited destination was reached.
- Retain the existing `npm run test:scanner`, Cloudflare compatibility/build gates, the staging scanner self-origin smoke, and redirect checks.
- Do not claim socket pinning unless the implementation actually pins the connection and preserves SNI / certificate identity.
