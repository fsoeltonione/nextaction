# NextAction Stage 14 — Staging & Production Release Gate

**Status:** Release-gate infrastructure implemented; dedicated staging Supabase is provisioned and seeded; activation still requires Cloudflare/CircleCI credentials and a deployed staging Worker.
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

OpenNext configuration is explicit in `wrangler.jsonc` and targets:

~~~text
.open-next/worker.js
.open-next/assets
~~~

The deployment adapter and Wrangler CLI versions are pinned in repository scripts:

~~~text
@opennextjs/cloudflare 1.20.6
wrangler 4.139.0
vinext 1.0.0-beta.11  (compatibility check only)
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

The endpoint returns only deployment identity information:

~~~json
{
  "status": "ok",
  "service": "nextaction",
  "environment": "staging"
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
STAGING_MOMENT_KEY
~~~


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

The seed script `supabase/staging/STAGE14_SEED.sql` creates a disposable publisher/advertiser topology, an integration credential, an Offer targeting the smoke Moment, advertiser capacity, and an initial Delivery. The executable smoke path uses the Integration token and Moment key, then requests a fresh Delivery through `/v1/offer`; the pre-created Delivery is available for fixture inspection but is not a CI input.

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

Not yet executable end-to-end:

- real staging deployment;
- real staging runtime smoke;
- production promotion through CircleCI.

Those now require:
- Cloudflare account credentials;
- CircleCI contexts/secrets;
- the seeded staging Integration token and Moment key stored as protected CI variables.

## 12. Exit criteria

Stage 14 reaches full operational completion when a real release-gate run proves:

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

Only after that gate should the project move to the DNS-aware SSRF/product-scanner hardening milestone.


## 12. Why the Cloudflare adapter is vinext

The real Stage 14 release gate exposed an incompatibility between the application's Next.js 16 `proxy.ts` and `@opennextjs/cloudflare@1.20.6`. The OpenNext build reached bundle generation and then failed while handling the middleware output; separate runs also showed its configuration validator constraints. The authoritative issue is not a missing application route or database object: Next.js 16 renamed Middleware to `proxy.ts`, and that Proxy runs on the Node.js runtime. Current Cloudflare documentation says Node.js in Middleware is not yet supported by the OpenNext adapter. Current Cloudflare documentation recommends vinext for Next.js on Workers, and its compatibility table lists both `middleware.ts` and `proxy.ts` as supported.

Therefore Stage 14 uses vinext for Cloudflare while retaining the existing Next.js build as the application-level quality check. This is a deployment-path change, not a domain/runtime business-logic change.
