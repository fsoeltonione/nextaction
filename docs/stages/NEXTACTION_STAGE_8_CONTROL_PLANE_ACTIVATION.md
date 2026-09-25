# NextAction Stage 8 — Control-Plane Activation

Status: Implemented and merged to `master`; final migration source synchronized with live Supabase.

## Objective

Replace the remaining onboarding prototype with the authoritative URL-first control-plane activation flow:

```
URL
→ conditional auth
→ product understanding
→ intent
→ Make Money / Reach Customers / Both
→ capability-specific setup
→ verification
→ truly ready
→ dashboard
```

Stage 8 does not implement the runtime Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement pipeline. It establishes the durable control-plane state required before runtime work begins.

## Locked invariants

- NextAction remains a contextual promotion network for SaaS products.
- Moment remains the core semantic primitive.
- Capability is workspace-level: `make_money`, `reach_customers`, or both.
- Product identity is based on normalized `canonical_url`.
- Product understanding is explicitly confirmed before activation.
- Offer targeting uses `offer_moments` as the relational source of truth.
- Private runtime and financial tables remain unavailable to browser clients.
- Financial rules are unchanged: $1.00 Qualified Click = $0.75 publisher / $0.25 NextAction.
- MVP activation does not require billing or live advertiser funding.

## Server-authoritative activation state

Activation state is derived from the current database state instead of a client-only step flag.

Inputs:
- workspace membership
- latest product for the selected workspace
- product `understanding_status`
- active workspace capabilities
- active product integration
- integration verification timestamp
- active offers targeting active Moments for the product

Derived steps:
- `url`: no product is available
- `product_understanding`: product exists but is not confirmed
- `intent`: product is confirmed but no capability is selected
- `capability_setup`: selected capability has required setup still missing
- `verification`: Make Money setup exists but credential verification is pending
- `ready`: every selected capability has satisfied Stage 8 prerequisites

The client keeps editable drafts only for the current step. After every mutation it reloads `GET /api/onboarding/state`.

## Product confirmation

`public.confirm_product_activation(...)` is the atomic persistence boundary for product understanding.

It:
1. requires an authenticated user;
2. resolves the user's workspace membership, creating the initial workspace only when none exists;
3. upserts the product by workspace + canonical URL;
4. marks the product understanding as confirmed;
5. disables previously stored Moments no longer present in the submitted definition;
6. upserts the submitted Moments as active;
7. validates Moment key, label, description and cardinality constraints.

The operation is implemented as a PostgreSQL function and therefore executes as one transaction. A failed Moment write rolls back the preceding product changes.

## Capability selection

`public.set_workspace_capabilities(text[])` is the authoritative write boundary for intent.

Rules:
- one or two capabilities only;
- only `make_money` and `reach_customers`;
- duplicates rejected;
- selected capabilities become active;
- previously active but unselected capabilities become disabled.

The application UI offers exactly three choices: Make Money, Reach Customers, and Both.

## Make Money setup

Stage 8 introduces a server-side product integration credential.

Flow:
1. authenticated user selects Make Money;
2. server verifies workspace membership and active Make Money capability;
3. server creates or reuses the product's `NextAction Runtime` integration;
4. server creates a random `na_live_` credential;
5. only the SHA-256 hash is persisted in `private.integration_secrets`;
6. plaintext credential is returned once to the authenticated setup UI;
7. user is instructed to keep the credential server-side;
8. verification hashes the submitted token and confirms it maps to the product integration.

The credential is not stored in browser persistence.

### Verification limitation

Stage 8 verification proves that the issued credential can be resolved and is attached to the authorized product/workspace. It does **not** prove that the future runtime `/v1/track` endpoint has received a real production Event.

Live runtime traffic verification belongs to the later runtime stage.

## Reach Customers setup

`public.create_offer_activation(...)` is the authoritative offer activation boundary.

It:
- requires the authenticated user;
- requires the workspace to have active `reach_customers`;
- validates offer title, description, CTA and HTTP(S) destination;
- rejects embedded URL credentials;
- accepts one to twenty unique Moment IDs;
- verifies every target Moment is active and belongs to the current workspace;
- creates the offer and its `offer_moments` rows atomically.

The route still accepts the legacy `target_moments` and `cta_url` fields as a transitional compatibility surface, but the new UI submits `moment_ids` and `destination_url`.

## URL and redirect boundary

Stage 8 continues to use the Stage 7 URL foundation.

Product URLs:
- HTTP/HTTPS only;
- no embedded credentials;
- obvious local/private IP and local hostname forms rejected;
- query and fragment removed for product identity;
- root URLs canonicalized without a trailing slash so existing records such as `https://carrd.com` remain identity-compatible.

Offer destination URLs:
- HTTP/HTTPS only;
- no embedded credentials;
- obvious local/private hostnames/IP literals rejected;
- query strings and fragments remain valid because they are normal destination URL components.

This is not DNS-aware SSRF prevention. The future product scanner must still add DNS-resolution validation, redirect revalidation, timeout and response-size controls before it fetches arbitrary product URLs.

## Routes introduced or upgraded

- `GET /api/onboarding/state`
- `POST /api/products/confirm`
- `POST /api/workspaces/capabilities`
- `POST /api/integrations/create`
- `POST /api/integrations/verify`
- `POST /api/offers/create`

The obsolete prototype `/api/products/save` route was removed so the old sequential persistence path cannot remain an alternate authority.

## Authentication / URL continuity

Landing now carries the normalized URL forward:

```
/ → /login?url=...
```

After authentication:

```
/login?url=...
→ /auth/callback?next=/onboarding?url=...
→ /onboarding?url=...
```

Stage 7's internal redirect allowlist remains the final redirect boundary.

If an authenticated user opens the landing URL with a new product URL, the onboarding page compares that URL with the server's current product and starts a new product-understanding proposal rather than discarding the URL.

## Database migrations applied live

- `20260925211435_stage_8_activation_foundation`
- `20260925211519_stage_8_activation_foundation_hardening`
- `20260925212247_stage_8_capability_enforcement`
- `20260925212601_stage_8_destination_url_compatibility`
- `20260925212930_stage_8_function_grant_hardening`

The second migration deliberately hardens the first implementation after a transaction-level SQL test exposed PL/pgSQL output-variable ambiguity. No test data survived that failed transaction.

## Verification performed

### Live positive transaction test

Under an authenticated user context:
- product confirmation succeeded;
- two capabilities were stored;
- one offer was created;
- one `offer_moments` row was created;
- the entire transaction was rolled back.

Observed test state before rollback:
- 1 temporary product
- 2 active capabilities
- 1 temporary offer
- 1 target link

### Negative test

A direct `create_offer_activation` call without an active `reach_customers` capability was rejected with PostgreSQL SQLSTATE `42501`.

### Post-test production counts

After rollback:
- workspaces: 2
- products: 3
- moments: 15
- offers: 0
- workspace capabilities: 0
- offer_moments: 0
- runtime events: 0
- settlements: 0

## Source-of-truth and generated types

Supabase TypeScript types were regenerated after the Stage 8 function changes and written to `src/lib/database.types.ts`.

The generated function contracts now expose:
- `confirm_product_activation`
- `set_workspace_capabilities`
- `create_offer_activation`

## Security posture after Stage 8

Supabase security advisor continues to report:
- intentional RLS-without-policy informational findings on private runtime/financial tables;
- the existing Auth warning that leaked-password protection is disabled.

No new Stage 8 security finding was introduced by the activation functions.

## Intentionally deferred

Stage 8 stops before runtime and launch infrastructure:

- DNS-aware server-side product scanner
- product surface discovery beyond the current AI proposal boundary
- real `/v1/track` runtime endpoint
- Event → Moment → Decision → Delivery runtime processing
- click and Qualified Click pipeline
- atomic settlement execution
- PGMQ/worker/queue infrastructure
- rate limiting
- production credential rotation/revocation UX
- live runtime traffic verification
- Cloudflare deployment adapter
- staging environment and CI/CD deployment gate
- production billing/payment integration

## Stage 8 completion criterion

Stage 8 is complete when the application can move a new authenticated workspace through the control plane using server state:

```
URL
→ product understanding confirmed
→ capability selected
→ capability-specific setup completed
→ verification completed where required
→ ready
→ dashboard
```

without relying on the removed prototype product-save path or client-only onboarding state.
