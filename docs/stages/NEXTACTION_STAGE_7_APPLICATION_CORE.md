# NextAction Stage 7 — Application Core & Security Boundary

**Status:** Implemented on branch `stage-7-application-core`  
**Date:** 2026-09-26  
**Depends on:** Product Truth, Architecture Truth, Data & Security Truth, API Contract Truth, Production Data Model

## 1. Objective

Stage 7 establishes reusable application-level boundaries on top of the Stage 6 database foundation.

It does not introduce a new product capability or change the locked business model.

The implementation focuses on:

- typed Supabase browser/server clients
- Next.js 16 Proxy session-refresh boundary
- request IDs and standardized API envelopes
- bounded JSON request bodies
- safe internal redirect handling
- product URL normalization and obvious private-host rejection
- hardened product analysis API behavior
- removal of generic Create Next App / Vercel product residue

## 2. Product invariants preserved

Stage 7 does not change:

```text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
```

or:

```text
Make Money
Reach Customers
Both
```

It also does not change MVP economics:

```text
$1 Qualified Click
$0.75 Publisher
$0.25 NextAction
```

## 3. Supabase client foundation

Both browser and server clients now use typed `Database` definitions generated from the live Supabase project.

The preferred public key is:

```text
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

A legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback is retained for transition compatibility.

Supabase's current documentation recommends `@supabase/ssr` with separate browser/server clients and a Proxy session refresh boundary for Next.js. citeturn463082search1turn958573view0

## 4. Next.js 16 Proxy boundary

The repository now contains a root:

```text
proxy.ts
```

and:

```text
src/utils/supabase/proxy.ts
```

The Proxy refreshes/validates the Supabase session before the application runs.

It deliberately does **not** redirect anonymous users to Login.

This is required because NextAction's product flow is conditional-auth and URL-first:

```text
URL
→ conditional auth
→ product understanding
→ intent
→ capability
→ ...
```

Next.js 16 renamed the Middleware convention to Proxy and documents `proxy.ts` as the current network-boundary mechanism. citeturn833833search0turn833833search1

## 5. HTTP foundation

`src/lib/http.ts` establishes:

- server-generated request IDs
- consistent success responses
- consistent error responses
- a bounded JSON request body reader
- a structured `HttpError`

Canonical error shape:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Safe human-readable message"
  },
  "request_id": "server-generated-id"
}
```

Raw upstream provider errors are not returned to callers.

## 6. URL foundation

`src/lib/url.ts` establishes one normalization path for product URLs.

The normalizer:

- accepts a URL with or without a scheme
- allows HTTP/HTTPS only
- removes fragments and query parameters from product identity
- removes default ports
- normalizes hostname case
- removes trailing path slashes
- rejects embedded credentials
- rejects obvious localhost/private/reserved host forms

This is a first boundary, not a claim of complete SSRF protection.

A future server-side scanner must still implement DNS-aware destination validation, redirect re-validation, timeout controls, response-size limits, and content-type controls before arbitrary remote content is fetched.

## 7. OAuth callback hardening

`/auth/callback` now:

- generates a request ID
- rejects missing authorization codes safely
- accepts only approved internal application destinations
- rejects external/open redirects
- avoids returning raw authentication errors
- records safe server-side diagnostics

The allowed navigation targets are currently scoped to:

```text
/dashboard
/onboarding
```

Supabase's current OAuth guidance also recommends checking that the `next` destination is relative before redirecting. citeturn463082search4

## 8. Product analysis API hardening

`POST /api/analyze` now:

- uses bounded request bodies
- accepts the target `url` contract
- temporarily accepts legacy `domain` input for UI compatibility
- normalizes the product URL before provider use
- enforces a provider timeout
- bounds provider response size
- validates provider JSON structure
- validates Moment keys and labels
- prevents raw provider errors from reaching users
- returns the standard request/error envelope

The current provider remains an implementation dependency and is not treated as authoritative product truth.

The response continues to expose a temporary compatibility surface for the existing prototype UI while the final control-plane confirmation flow is built.

## 9. Vercel residue

Generic Create Next App metadata and README content were removed.

The README now identifies:

- NextAction as the product
- the locked domain chain
- Cloudflare as the planned hosting target
- GitHub migrations/docs as the source of truth

No Vercel deployment configuration was added.

## 10. Verification status

Verified by source inspection against the current GitHub `master` baseline and current Supabase/Next.js documentation.

The following application invariants are now encoded:

- request bodies are bounded
- request IDs are server-generated
- internal redirects are constrained
- client Supabase access uses publishable-key semantics
- server Supabase access is cookie based
- session refresh occurs at the Next.js Proxy boundary
- analysis provider failures are sanitized
- product identity URL normalization is centralized

## 11. Not yet implemented

Stage 7 intentionally does not yet implement:

- Product Confirmation transaction endpoint
- capability persistence UI/API
- integration credential issuance
- runtime `/v1/track`
- runtime `/v1/offer`
- runtime click/qualification/settlement flow
- DNS-aware remote scanner
- rate limiting
- queue/PGMQ worker
- Cloudflare deployment adapter
- staging project / CI deployment gate

Those belong to subsequent implementation stages.

## 12. Stage exit condition

Stage 7 is complete when the application has reusable, security-conscious primitives that subsequent control-plane and runtime implementations can consume without directly depending on prototype behavior.

The next stage should build the **real control-plane activation flow** on these primitives, followed by runtime integration implementation.
