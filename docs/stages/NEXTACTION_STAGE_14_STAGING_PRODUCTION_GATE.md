# NextAction Stage 14 — Staging & Production Release Gate

**Status:** Release-gate infrastructure implemented; activation requires external staging credentials and a dedicated staging Supabase project.
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

Cloudflare's current Next.js documentation recommends vinext for new/default Workers deployments and provides a compatibility-check workflow. For this existing application, Stage 14 keeps the current Next.js toolchain and uses OpenNext for the deployment adapter while running `vinext check` as a compatibility gate. This avoids silently converting the application's build system during a release-hardening stage.

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

The staging smoke harness:

1. requires an HTTPS staging URL;
2. verifies `GET /api/health` returns the expected environment;
3. requires a pre-seeded staging Delivery token;
4. calls `GET /v1/click/:delivery_token`;
5. requires HTTP `302`;
6. verifies the redirect target uses HTTP(S);
7. replays the same Delivery token;
8. requires HTTP `302` again;
9. verifies the replay destination is identical.

Because the click runtime only redirects after successful qualification and settlement, the two navigation checks exercise the deployed chain:

~~~text
Delivery
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
STAGING_BASE_URL
STAGING_DELIVERY_TOKEN
~~~

### Production

~~~text
PRODUCTION_NEXT_PUBLIC_SUPABASE_URL
PRODUCTION_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
PRODUCTION_SUPABASE_SECRET_KEY
PRODUCTION_BASE_URL
~~~

The current connected Supabase account exposes the NextAction production project and an unrelated `ragamstudio` project; no dedicated NextAction staging project is available. The unrelated project is not used as staging.

No new paid/billable project is created automatically by Stage 14.

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
- current OpenNext package version used by the deployment script;
- live production database is clean after Stage 13 smoke;
- production runtime settlement privileges remain service-role-only.

Not yet executable end-to-end:

- real staging deployment;
- real staging runtime smoke;
- production promotion through CircleCI.

Those require the external staging Supabase project, Cloudflare account credentials, and a seeded disposable staging Delivery.

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
