# NextAction Stage 14 — Staging & Production Release Gate

**Status:** FULLY COMPLETED and release-gated. Stage 14 has passed the real staging and production release path on `08761a61fd14354e5bdbef13cc43ba24deaec10e`.
**Date:** 2026-09-26
**Baseline:** Stage 13 `master` commit `9992efd9d0ec54a95676cf8bc7152fedd70d1230`

## 1. Purpose

Stage 14 turns the runtime into a deployable release pipeline without treating a Git merge as proof that the deployed Worker is healthy.

The release path is:

~~~text
GitHub
  ↓
CircleCI quality
  ↓
Cloudflare compatibility check
  ↓
Cloudflare build validation
  ↓
Staging deployment
  ↓
Staging smoke
  ↓
Production approval
  ↓
Production deployment
  ↓
Production health smoke
~~~

CircleCI supports workflow dependencies and explicit approval jobs; the production promotion gate uses that model.

## 2. Deployment target

NextAction does not use Vercel.

The Stage 14 deployment target is Cloudflare Workers.

Cloudflare's current Next.js documentation recommends vinext as the default Workers deployment path. Stage 14 now uses vinext for the Cloudflare build/deployment path while retaining the normal Next.js build for the existing application quality gate. This is necessary because the application uses Next.js 16 `proxy.ts`, which runs on the Node.js runtime; the current OpenNext Cloudflare adapter documentation states that Node.js in Middleware is not yet supported, while vinext supports `proxy.ts` and `middleware.ts`.

vinext configuration is explicit in `vite.config.mjs` and `wrangler.jsonc` and targets:

~~~text
vinext/server/fetch-handler
dist/client
~~~

The Cloudflare build toolchain is pinned by `scripts/cloudflare-vinext-build.mjs`:

~~~text
vinext 1.0.0-beta.12
@vinext/cloudflare 1.0.0-beta.10
@cloudflare/vite-plugin 1.54.11
vite 8.3.0
@vitejs/plugin-rsc 0.5.35
react-server-dom-webpack 19.2.8
wrangler 4.139.0
~~~

## 3. Cloudflare environments

Wrangler environments are:

~~~text
staging
  Worker: nextaction-staging
  workers.dev enabled

production
  Worker: nextaction
  workers.dev enabled
~~~

Environment-specific configuration is kept in `wrangler.jsonc`.

Secrets are never committed.

The deployment script writes the environment-specific Supabase secret into the corresponding Cloudflare Worker using Wrangler, then builds and deploys the application.

## 4. Runtime health endpoint

Stage 14 adds:

~~~text
GET /api/health
~~~

The endpoint returns deployment identity information. The environment field is target-specific build metadata supplied by the deployment script; runtime_environment_configured reports whether the Worker exposes the runtime APP_ENV binding:

~~~json
{
  "status": "ok",
  "service": "nextaction",
  "environment": "staging",
  "runtime_environment_configured": true
}
~~~

It is cache-disabled and does not expose credentials, database identifiers, or financial state.

## 5. Staging smoke

The staging smoke harness derives the deployed staging Worker URL from Wrangler output; no manually configured Worker URL is required.

The staging smoke harness:

1. requires an HTTPS staging URL;
2. verifies `GET /api/health` returns the expected environment;
3. requires a staging Integration token and canonical Moment key;
4. calls `POST /v1/track` and verifies Event acceptance;
5. replays the same Event idempotency key and verifies the original Event is returned;
6. calls `POST /v1/offer` for the smoke Moment and obtains a fresh Delivery token;
7. calls `GET /v1/click/:delivery_token`;
8. requires HTTP `302`;
9. verifies the redirect target uses HTTP(S);
10. replays the same Delivery token and verifies the redirect destination is unchanged.

The Offer call creates the Delivery used by the smoke. A separate `STAGING_DELIVERY_TOKEN` is therefore not required by the executable smoke harness.

Because the click runtime only redirects after successful qualification and settlement, the deployed checks exercise the full chain:

~~~text
Event
  ↓
Moment → Decision → Delivery
  ↓
Click
  ↓
Qualified Click
  ↓
Settlement
  ↓
302
~~~

## 6. CircleCI release workflow

The default `quality-gate` workflow remains unchanged for ordinary pushes/PRs:

~~~text
quality
  = lint + typecheck + Next build
~~~

A separate opt-in `release-gate` workflow is controlled by:

~~~text
run_release_gate = true
~~~

When enabled:

~~~text
quality
  ↓
cloudflare_compatibility
  ↓
cloudflare_build
  ↓
deploy_staging
  ↓
staging_smoke
  ↓
hold_production (manual approval)
  ↓
deploy_production
  ↓
production_smoke
~~~

Production cannot deploy before staging smoke passes and the explicit approval job is approved.

## 7. External prerequisites

A true staging release cannot be executed from the repository alone.

Stage 14 therefore treats these as explicit environment prerequisites:

### Cloudflare

~~~text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
~~~

### Staging Supabase

~~~text
STAGING_NEXT_PUBLIC_SUPABASE_URL
STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
STAGING_SUPABASE_SECRET_KEY
~~~

### Staging smoke

~~~text
STAGING_INTEGRATION_TOKEN
~~~

The Stage 14 smoke Moment key is the immutable constant `stage14_smoke_moment`
defined in `scripts/staging-smoke.mjs`; it is intentionally **not** a context
variable, so the smoke can never drift from the seeded fixture.


### Production

~~~text
PRODUCTION_NEXT_PUBLIC_SUPABASE_URL
PRODUCTION_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
PRODUCTION_SUPABASE_SECRET_KEY
~~~

The connected Supabase Free organization now contains:
- production project `nextaction` (`khoygjyikxkdwonygzyh`);
- staging project `nextaction-staging` (`njjybpswxalxjhqjlvqa`, region `ca-central-1`).

The unrelated `ragamstudio` project remains separate from NextAction and is currently inactive/paused.

The staging project was provisioned at $0/month under the current Free organization and seeded with the disposable Stage 14 fixture. No production data is used by the staging fixture.

A separate Ragamstudio organization has not yet been created because the currently connected Supabase tool surface does not expose organization-creation/project-transfer actions. This is an administrative UI/API step and does not block the existence of the isolated NextAction staging project.

## 8. Staging data isolation

Production Supabase data must never be reused as a staging fixture when settlement writes are being tested.

A dedicated staging Supabase project is required before the full release gate is enabled.

Staging must contain:

- one publisher workspace/product/Moment;
- one active publisher integration;
- one advertiser workspace;
- one active Offer targeting the publisher Moment;
- one advertiser capacity account with at least one available unit;
- one test Delivery token.

The staging fixture must be disposable and must not contain real customer data.

The staging bootstrap `supabase/staging/STAGE14_BOOTSTRAP.sql` prepares the legacy prototype tables and disposable anonymous auth owner required by the fixture. The seed script `supabase/staging/STAGE14_SEED.sql` then creates a disposable publisher/advertiser topology, an integration credential, an Offer targeting the smoke Moment, advertiser capacity, and an initial Delivery. The executable smoke path uses the Integration token and Moment key, then requests a fresh Delivery through `/v1/offer`; the pre-created Delivery is available for fixture inspection but is not a CI input.

The reset script `supabase/staging/STAGE14_RESET.sql` removes the disposable runtime and financial data in dependency-safe order.

## 9. Failure semantics

The release gate treats these as hard failures:

- Cloudflare compatibility check failure;
- Cloudflare build failure;
- staging deployment failure;
- staging health failure;
- staging click/redirect failure;
- production deployment failure;
- production health failure.

The production approval job is downstream of staging smoke, so a failed staging release cannot be promoted by the workflow dependency graph.

## 10. Security boundary

Deployment credentials are CI/Cloudflare secrets.

The repository contains no:

- Supabase service-role key;
- Cloudflare API token;
- real staging URL with embedded credentials;
- production secret.

The health endpoint and smoke harness intentionally avoid exposing secrets or financial amounts.

## 11. Current Stage 14 completion state

Implemented in Git:

- Cloudflare Wrangler environment configuration;
- Cloudflare deployment script;
- Cloudflare compatibility check script;
- staging/production smoke harness;
- deployment health endpoint;
- CircleCI release-gate workflow;
- production approval gate;
- updated deployment documentation.

Validated directly:

- Cloudflare's current deployment model and environment semantics;
- current Cloudflare recommendation for vinext;
- current vinext package version used by the deployment path.
- live production database is clean after Stage 13 smoke;
- production runtime settlement privileges remain service-role-only.

End-to-end validation is complete.

A real CircleCI release-gate run has proven:
- staging deployment;
- staging runtime smoke;
- Event idempotency;
- Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement;
- click replay/idempotency;
- production approval;
- production deployment;
- production health smoke.

## 12. Exit criteria

Stage 14 reached full operational completion after the real release-gate run on `08761a61fd14354e5bdbef13cc43ba24deaec10e` proved:

~~~text
CircleCI quality
  ↓
Cloudflare compatibility
  ↓
staging deploy
  ↓
staging health
  ↓
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
  ↓
replay/idempotency
  ↓
production approval
  ↓
production deploy
  ↓
production health
~~~

Stage 14 is now locked. The next implementation milestone is the DNS-aware SSRF/product-scanner hardening work, subject to the Final Launch Readiness/Gate E security exception recorded separately.


## 12. Why the Cloudflare adapter is vinext

The real Stage 14 release gate exposed an incompatibility between the application's Next.js 16 `proxy.ts` and `@opennextjs/cloudflare@1.20.6`. The OpenNext build reached bundle generation and then failed while handling the middleware output; separate runs also showed its configuration validator constraints. The authoritative issue is not a missing application route or database object: Next.js 16 renamed Middleware to `proxy.ts`, and that Proxy runs on the Node.js runtime. Current Cloudflare documentation says Node.js in Middleware is not yet supported by the OpenNext adapter. Current Cloudflare documentation recommends vinext for Next.js on Workers, and its compatibility table lists both `middleware.ts` and `proxy.ts` as supported.

Therefore Stage 14 uses vinext for Cloudflare while retaining the existing Next.js build as the application-level quality check. This is a deployment-path change, not a domain/runtime business-logic change.


## 13. Gate E security exception

The Supabase leaked-password protection advisory remains enabled as an accepted MVP security exception because the project remains on the Supabase Free plan. This is not a resolved finding. The exception is documented in `docs/data-security/NEXTACTION_SECURITY_EXCEPTIONS.md` and must be revisited before password-based authentication is introduced.
