# NextAction Stage 10 — Click Runtime

**Status:** Implemented on `stage-10-click-runtime`; pending CircleCI quality verification and merge to `master`.
**Date:** 2026-09-26
**Baseline:** Stage 9 `master` commit `60022390f08e9975235542bf76149f3c2ed54ba3`

## 1. Objective

Stage 10 implements the first executable Click segment while preserving the locked domain chain:

~~~text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
~~~

Stage 10 implements:

- `GET /v1/click/:delivery_token`
- delivery-token hashing and lookup
- delivery expiry enforcement
- atomic/idempotent Click recording
- server-side trusted destination resolution
- replay-safe redirects
- IP-scoped click rate limiting

Stage 10 does not implement:

- Qualified Click policy
- Qualified Click evidence/versioning
- Settlement execution
- advertiser debit
- publisher credit
- platform financial ledger mutation

Those remain later milestones because the authoritative documents do not yet define the qualification policy/evidence required to decide when a Click becomes financially qualified.

## 2. Runtime flow

The Click request is a browser navigation against a previously issued Delivery token:

~~~text
GET /v1/click/:delivery_token
        ↓
bounded token validation
        ↓
SHA-256(token)
        ↓
private.runtime_record_click(...)
        ↓
validate Delivery + expiry
        ↓
record/retrieve Click
        ↓
resolve trusted Offer destination
        ↓
302 redirect
~~~

No client-supplied destination, price, qualification result, publisher share, advertiser debit, or settlement state is accepted.

## 3. Click identity

The raw Delivery token is never persisted by the Click route.

The route hashes the received token with SHA-256. The database function compares that hash against `private.deliveries.delivery_token_hash` and uses the same hash as the unique Click identity `private.clicks.click_token_hash`.

This gives one Click record per issued Delivery token while preserving the existing database uniqueness boundary.

## 4. Delivery validation

A Click is accepted only when:

- the SHA-256 token hash matches an existing Delivery;
- the Delivery has not expired;
- the associated Offer has a valid HTTP(S) destination.

An invalid or expired token returns a controlled `404` response.

The Click route never accepts a destination URL from the request path other than the opaque Delivery token itself.

## 5. Idempotency and replay

The Click persistence boundary uses:

~~~sql
INSERT ... ON CONFLICT (click_token_hash) DO NOTHING
~~~

Therefore concurrent or repeated browser requests cannot create multiple Click rows for the same Delivery token.

A replay returns the existing Click state and resolves the same trusted server-side destination.

Stage 10 does not create any financial mutation, so a replay cannot create duplicate economics.

## 6. Qualification boundary

Every new Click starts with:

~~~text
qualification_status = pending
~~~

No inference is made from IP address, browser headers, URL query parameters, client-provided values, or timing heuristics.

The Click is therefore recorded as an immutable runtime observation while qualification remains an explicit later policy decision.

## 7. Redirect safety

The destination is read from `private.deliveries → offer_id → public.offers.destination_url`.

The route additionally parses the returned URL and permits only `http:` and `https:`.

The client cannot substitute another destination.

Responses use `302` with `Cache-Control: no-store` and an `X-Request-Id` header.

## 8. Rate limiting

Click requests are protected before the database mutation with the existing runtime rate limiter:

~~~text
runtime:click:ip
~~~

The subject is derived from the existing request-IP extraction boundary.

The current operational limit is `120` requests per minute per derived IP subject.

The limit is an operational protection setting, not a product or financial rule.

## 9. Database security boundary

The Click persistence function `public.runtime_record_click(text)` is:

- `SECURITY DEFINER`
- `SET search_path = ''`
- explicitly revoked from `PUBLIC`, `anon`, and `authenticated`
- executable only by `service_role`

This keeps direct access to private runtime tables outside browser/publisher authority.

## 10. Error behavior

Runtime Click responses use:

- `404` — delivery not found
- `404` — delivery expired
- `429` — rate limit exceeded
- `503` — runtime protection/database/destination failure
- `302` — successful or replayed click redirect

Malformed internal hash inputs are treated as controlled server validation failures and are not exposed as database details.

## 11. Verification plan

Stage 10 must prove:

1. valid Delivery token creates exactly one Click;
2. repeating the same token returns the same Click identity;
3. concurrent replay cannot create duplicate Click rows;
4. expired Delivery returns `404` and creates no Click;
5. unknown Delivery returns `404` and creates no Click;
6. destination comes from server-side Offer state;
7. changing request-controlled values cannot change the redirect target;
8. `anon` and `authenticated` cannot execute `runtime_record_click`;
9. runtime database counts return to the pre-test baseline after temporary fixtures are removed.

No Qualified Click or Settlement row is created by these tests.

## 12. Known remaining gaps

The following remain outside Stage 10:

- qualification rules
- qualification evidence model
- fraud/abuse qualification policy
- Qualified Click persistence beyond the existing table
- settlement execution
- advertiser debit ledger mutation
- publisher credit ledger mutation
- platform revenue ledger mutation
- payment/payout integration
- DNS-aware product scanner
- automated Cloudflare staging deployment

Stage 10 therefore advances the executable chain from:

~~~text
Event → Moment → Decision → Delivery
~~~

to:

~~~text
Event → Moment → Decision → Delivery → Click
~~~

without inventing financial qualification semantics.