# NextAction API & Contract Truth

**Status:** Authoritative v1  
**Depends on:** `docs/NEXTACTION_PRODUCT_DOMAIN_TRUTH.md`, `docs/architecture/NEXTACTION_ARCHITECTURE_TRUTH.md`, `docs/data-security/NEXTACTION_DATA_SECURITY_TRUTH.md`  
**Baseline:** Stage 9 `master` commit `60022390f08e9975235542bf76149f3c2ed54ba3`
**Runtime implementation:** Stage 10 branch `stage-10-click-runtime`  
**Date:** 2026-09-26

## 1. Purpose

This document defines the authoritative HTTP/API contract for NextAction.

It separates:
- browser/control-plane requests
- public publisher runtime requests
- authentication callbacks
- internal application operations

The contract remains authoritative for the executable runtime. Stage 14 carries the implementation through `/v1/track`, `/v1/offer`, `/v1/click/:delivery_token`, Qualified Click, and atomic Settlement, with deployment/release controls defined separately.

## 2. API surface

NextAction has two API classes.

### Control Plane API

Used by the NextAction web application.

Authentication:
- Supabase user session/cookie for authenticated operations
- anonymous access only for explicitly public onboarding analysis

Primary logical operations:
- Product Analysis
- Product Confirmation
- Capability Selection
- Workspace/Product configuration
- Offer configuration

These endpoints are application APIs, not the publisher integration API.

### Runtime API

Used by publisher SaaS integrations.

Canonical endpoints:

```
POST /v1/track
POST /v1/offer
GET  /v1/click/:delivery_token
```

These are the externally meaningful runtime contract.

## 3. Global API rules

### Content type

JSON request bodies use:

```
Content-Type: application/json
```

Responses that contain JSON use:

```
Content-Type: application/json
```

### Request identifier

Every request receives a server-generated `request_id`.

Clients may supply an optional correlation/request identifier. The server may reject malformed identifiers but must never trust them as authentication or authorization.

### Idempotency

Mutation endpoints that can be retried must support an idempotency key.

Canonical header:

```
Idempotency-Key: <opaque-client-generated-key>
```

At minimum:
- `/v1/track`
- click processing

Idempotency keys are scoped to the authenticated integration unless explicitly stated otherwise.

### Timeouts

Runtime endpoints have explicit bounded latency budgets.

Timeout behavior is part of the contract, not an implementation detail.

### Error envelope

JSON errors use:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Safe human-readable message"
  },
  "request_id": "server-request-id"
}
```

Error messages must not contain:
- API secrets
- service-role credentials
- raw upstream provider responses
- database connection details
- stack traces
- internal financial state

## 4. Authentication classes

### Anonymous web

Allowed only for:
- landing page
- product-analysis proposal

No tenant data access.

### Authenticated web user

Uses the NextAction/Supabase browser session.

Used for:
- workspace configuration
- confirmed product persistence
- capability selection
- offer configuration
- dashboard reads/writes

The server must revalidate the authenticated identity before protected operations.

### Publisher integration

Uses an integration credential associated with one product.

Conceptual transport:

```
Authorization: Bearer <integration-token>
```

Runtime integration credentials use the `na_live_` prefix and are persisted only as SHA-256 hashes. Runtime code resolves them through a service-role-only database function.

The server resolves:

```
integration credential
  -> integration
  -> product
  -> workspace
```

The request must not be able to replace that product/workspace identity.

### Privileged server path

Privileged database access is internal only.

No browser or publisher request may carry a Supabase service-role secret.

## 5. Product Analysis contract

### Logical endpoint

```
POST /api/analyze
```

Purpose:
Return a proposed Product Understanding from an untrusted user-supplied URL.

This endpoint is a web onboarding API, not a publisher runtime API.

### Request

```json
{
  "url": "https://example-saas.com"
}
```

The server must normalize and validate the URL before retrieval.

### Response

```json
{
  "analysis": {
    "url": "https://example-saas.com",
    "name": "Example SaaS",
    "description": "A concise description.",
    "moments": [
      {
        "key": "invoice_created",
        "label": "Invoice Created",
        "description": "An invoice has been created and is ready for follow-up."
      }
    ]
  },
  "request_id": "..."
}
```

The response represents a proposal.

It is not persisted Product truth until the authenticated user confirms it.

### Public failure behavior

Expected categories:
- invalid URL -> `400`
- rate limited -> `429`
- upstream retrieval timeout -> bounded `5xx` or controlled analysis failure
- provider unavailable -> `503`
- malformed model output -> `502` or controlled analysis failure

The endpoint must never echo raw upstream error bodies.

## 6. Product confirmation contract

### Logical endpoint

```
POST /api/products/confirm
```

Purpose:
Persist user-confirmed Product Understanding.

Authentication:
Authenticated user only.

The server determines the target workspace from the authenticated user/session.

### Request

```json
{
  "url": "https://example-saas.com",
  "name": "Example SaaS",
  "description": "User-confirmed description.",
  "moments": [
    {
      "key": "invoice_created",
      "label": "Invoice Created",
      "description": "An invoice has been created and is ready for follow-up."
    }
  ]
}
```

### Rules

The server must:
- validate schema and field limits
- normalize the URL/domain
- validate Moment keys
- persist the product and Moment definitions atomically
- never accept client-supplied workspace ownership
- not accept or modify financial values

### Response

```json
{
  "product": {
    "id": "opaque-product-id"
  },
  "request_id": "..."
}
```

## 7. Capability selection contract

### Logical endpoint

```
POST /api/workspaces/capabilities
```

Purpose:
Persist activation intent.

### Request

```json
{
  "capabilities": ["make_money", "reach_customers"]
}
```

Allowed values:
- `make_money`
- `reach_customers`

Both may be present.

The server must enforce that the authenticated user owns the workspace being modified.

### Response

```json
{
  "capabilities": ["make_money"],
  "request_id": "..."
}
```

## 8. /v1/track contract

### Purpose

Accept a raw publisher Event quickly and asynchronously.

Canonical domain position:

```
Event
```

### Authentication

Publisher integration credential required.

### Request

```http
POST /v1/track
Authorization: Bearer <integration-token>
Idempotency-Key: evt_opaque_unique_key
Content-Type: application/json
```

Body:

```json
{
  "type": "invoice.created",
  "occurred_at": "2026-09-26T10:20:30Z",
  "data": {
    "invoice_id": "publisher-defined-opaque-id"
  }
}
```

The request may contain bounded metadata, but the contract must define maximum payload size.

The publisher does not supply:
- workspace_id
- settlement values
- qualification state
- publisher earnings
- advertiser charges

These are never accepted as authoritative input.

### Success

The preferred response is fast acceptance:

```
202 Accepted
```

Example:

```json
{
  "accepted": true,
  "event_id": "opaque-event-id",
  "request_id": "..."
}
```

The API does not guarantee that Moment normalization has completed when the response is returned.

### Retry behavior

Repeated requests with the same integration scope + Idempotency-Key must not create duplicate Event occurrences.

## 9. /v1/offer contract

### Purpose

Request a contextual Offer Decision for a publisher surface.

Canonical domain positions:

```
Decision -> Delivery
```

### Authentication

Publisher integration credential required.

### Request

```http
POST /v1/offer
Authorization: Bearer <integration-token>
Content-Type: application/json
```

Body:

```json
{
  "moment_key": "invoice_created",
  "context": {
    "surface": "invoice_detail"
  }
}
```

The integration credential already identifies the product/workspace.

Optional context must be bounded and must not become an implicit identity graph.

### Success with fill

```
200 OK
```

Example:

```json
{
  "delivery": {
    "token": "opaque-signed-delivery-token",
    "offer": {
      "title": "Get paid faster",
      "description": "Accept online payments from your customers.",
      "cta_label": "Learn More"
    },
    "expires_at": "2026-09-26T10:21:00Z"
  },
  "request_id": "..."
}
```

The delivery token is an opaque, server-issued, high-entropy token. Only its SHA-256 hash is persisted; it must not expose financial or internal database fields.

### No fill

```
204 No Content
```

No-fill is a normal outcome.

It may result from:
- no matching eligible offer
- exhausted advertiser capacity
- paused offer
- policy rejection
- protected timeout/failure path

The host SaaS should treat no-fill as "nothing to render."

### Critical runtime rules

`/v1/offer` must not:
- call the LLM
- perform URL scanning
- wait on slow asynchronous jobs
- require an end-user Supabase session
- charge advertiser capacity merely for selecting an offer

## 10. /v1/click contract

### Purpose

Process a user click against a previously delivered Offer.

Canonical domain positions:

```
Click -> Qualified Click -> Settlement
```

### Endpoint

```
GET /v1/click/:delivery_token
```

This is a browser-navigation endpoint.

### Request

The browser follows the signed Delivery token URL.

No price, qualification status, publisher share, or advertiser debit amount is accepted from the client.

### Server processing

Stage 13 completes the executable runtime chain through Settlement:

```
verify delivery token
  -> validate delivery state
  -> record/retrieve Click
  -> apply Qualification Policy v1
  -> persist/retrieve Qualified Click evidence
  -> settle Qualified Click atomically
  -> resolve trusted destination
  -> redirect
```

Stage 12 makes the Click qualified under qv1. Stage 13 then executes the financial Settlement transaction.

### Qualification Policy v1

A Click qualifies when all of the following are true:

1. the Delivery token is valid;
2. the Delivery is not expired when the first Click is processed;
3. the trusted server-side destination is valid;
4. the Click is the first Click represented by that Delivery token.

Policy-controlled evidence is:

```
qualification_version = "qv1"
reason_code = "qv1_valid_first_delivery_click"
qualified_at = database timestamp
```

The policy does not use device fingerprinting, cross-site identity tracking, a persistent identity graph, LLM fraud scoring, or client-supplied qualification/financial fields.

### Settlement policy

For a Qualified Click, MVP settlement is server-derived:

```
charge_cents          = 100
publisher_share_cents = 75
platform_share_cents  = 25
currency              = USD
capacity consumption  = 1 unit
```

The settlement transaction locks the Qualified Click and advertiser capacity, verifies available capacity, creates the Settlement, creates the three financial ledger entries, records one capacity consumption, and commits atomically.

Settlement is retried safely. A repeated request for the same Qualified Click returns the existing Settlement and does not create duplicate debit, credit, revenue, or capacity-consumption records.

### Qualified result

After successful first-click qualification and settlement, the server redirects to the trusted destination associated with the Delivery/Offer.

The redirect target is not accepted from the click request.

### Settlement unavailable

If a Qualified Click cannot be settled because advertiser capacity is unavailable or required financial configuration is unavailable, the click endpoint returns a controlled `503` and does not report a successful navigation.

The Qualified Click remains server-authoritative and can be retried by the runtime after the blocking condition is resolved.

### Invalid/non-eligible result

Invalid or expired Delivery requests do not create a Click or Qualified Click and return `404`.

A settlement attempt against a missing or non-qualified Click cannot create financial records.

### Replay behavior

The same signed Delivery/click state may be retried by browsers, proxies, or users.

Therefore click processing must be idempotent.

A replay returns the existing Click, Qualified Click, and Settlement state and must not create:
- duplicate Click
- duplicate Qualified Click
- duplicate Settlement
- duplicate advertiser debit
- duplicate publisher credit
- duplicate platform revenue
- duplicate advertiser capacity consumption

Database uniqueness and transaction locking remain the final duplicate-prevention boundaries.

## 11. HTTP status semantics


### Control plane

- `200` successful read/update
- `201` resource created where appropriate
- `400` malformed request
- `401` missing/invalid user session
- `403` authenticated but not authorized
- `404` resource not found
- `409` state/uniqueness conflict
- `422` semantically invalid payload where adopted
- `429` rate limited
- `500` unexpected internal error
- `503` dependency unavailable

### Runtime

- `200` offer delivered
- `202` event accepted for asynchronous processing
- `204` no-fill / safe no-op for Offer decision
- `301/302/303` controlled redirect for click navigation as appropriate
- `400` invalid request envelope
- `401` invalid/missing integration credential
- `403` credential valid but not permitted/revoked
- `404` invalid/expired delivery token
- `409` idempotency/state conflict where applicable
- `429` abuse/rate limit
- `5xx/503` internal/dependency failure

The runtime contract must prefer host-safe no-fill behavior over propagating infrastructure failure to the publisher surface.

## 12. Security rules

### Never trust the client for

- workspace identity
- product ownership
- financial amounts
- qualification state
- settlement state
- advertiser capacity
- publisher earnings
- destination URL

### Signed state

Delivery tokens are server-issued and must be:
- tamper resistant
- scoped to a Delivery
- bounded by expiry where appropriate
- non-reusable for duplicate settlement

The current implementation uses an opaque high-entropy token with SHA-256 hash persistence; Stage 10 verifies the token against Delivery state before recording/retrieving a Click.

### Open redirects

No endpoint may redirect to a client-supplied arbitrary URL.

The destination must resolve from trusted server-side Offer/Delivery state.

## 13. CORS and browser policy

Publisher runtime APIs are cross-origin by design.

The final implementation must define:
- allowed methods
- response headers
- preflight behavior
- credential policy
- origin handling

CORS must never be used as an authentication mechanism.

The integration credential remains the authorization boundary.

## 14. Rate limiting

Rate limits are part of the public runtime contract.

At minimum, controls must exist for:
- product analysis
- `/v1/track`
- `/v1/offer`
- `/v1/click/:delivery_token`

Limits should be associated with the most appropriate trusted identity:
- IP for anonymous abuse protection
- integration credential for publisher runtime
- authenticated user/workspace for control-plane abuse controls

Exact limits are not locked in this phase.

## 15. API versioning

Runtime integrations use an explicit version prefix:

```
/v1/...
```

Breaking changes require a new version.

Non-breaking additions may be introduced within `v1` provided:
- existing required fields remain valid
- existing response semantics remain valid
- no previously valid request changes meaning

Control-plane `/api/*` routes are internal web-application contracts and may evolve independently from the public publisher API.

## 16. Contract schema ownership

The API contract must eventually have executable schemas shared by:
- route validation
- tests
- documentation
- client types

The preferred direction is a single source of schema truth rather than manually duplicated TypeScript interfaces.

The exact schema library and OpenAPI generation approach remain implementation decisions.

## 17. Compatibility rules

A publisher integration must be able to:
1. send Events without waiting for normalization
2. request an Offer by canonical Moment
3. receive no-fill safely
4. render a returned Offer natively
5. follow a signed click destination
6. retry safely

No runtime endpoint should require knowledge of NextAction's internal database IDs or private schemas.

## 18. Current implementation status

Stage 14 adds the deployment/release boundary around the executable runtime.

The runtime remains:

- `POST /v1/track`
- `POST /v1/offer`
- `GET /v1/click/:delivery_token`

The release path now includes:

- Cloudflare deployment configuration;
- separate staging and production Workers;
- staging health check;
- staging click/replay smoke;
- production approval gate;
- production health smoke.

The following remain intentionally unimplemented:

- DNS-aware SSRF controls for a future server-side URL scanner
- automated production promotion without the explicit CircleCI approval gate

## 19. Authentication callback contract



### Endpoint

```
GET /auth/callback
```

Purpose:
Exchange the Supabase authorization code for an authenticated browser session.

Rules:
- use the established Supabase SSR/PKCE flow
- persist session state through the server/browser cookie mechanism
- allow redirects only to server-approved relative application paths
- reject or normalize external redirect destinations
- do not expose auth codes or tokens in application logs

The current `next` query parameter must not become an open redirect primitive.

## 20. API invariants

1. Public runtime authentication is separate from user authentication.
2. Integration credentials determine product/workspace context.
3. `/v1/track` accepts Events asynchronously.
4. `/v1/offer` performs Decision/Delivery only.
5. `/v1/offer` never settles money.
6. Click qualification is server-authoritative.
7. Settlement occurs only after qualification.
8. Duplicate retries cannot create duplicate financial outcomes.
9. Client-supplied financial values are never authoritative.
10. Click destinations come only from trusted server state.
11. Runtime failure is host-safe.
12. API contracts are versioned independently from internal implementation details.

## 21. Stage 4 exit criteria

Stage 4 is complete as a specification when the implementation team can build automated contract tests for:
- every request shape
- every success shape
- every error class
- authentication failure
- authorization failure
- no-fill behavior
- retry/idempotency behavior
- signed click validation
- redirect safety
- runtime timeout behavior

Only then should the production API routes be implemented.
