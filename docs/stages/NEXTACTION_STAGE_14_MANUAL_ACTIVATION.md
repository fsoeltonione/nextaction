# NextAction Stage 14 — Manual Activation Checklist

This document covers the small number of external administrative steps that cannot be performed by the repository tooling.

## 1. Supabase organization for Ragamstudio

Current state:
- NextAction production: `nextaction`
- NextAction staging: `nextaction-staging`
- Ragamstudio: `ragamstudio` is inactive/paused

Create a separate Free organization for Ragamstudio in the Supabase dashboard.

Then transfer the `ragamstudio` project from the current organization to the new Ragamstudio organization.

Supabase project transfer prerequisites include being Owner of the source organization, being at least Member of the target organization, and having no active GitHub integration connection or log drains on the project.

Reference:
https://supabase.com/docs/guides/platform/project-transfer

Do not delete the Ragamstudio project.

## 2. Cloudflare account prerequisites

NextAction deploys to Cloudflare Workers.

Create or use a Cloudflare API token with only the permissions required for Workers deployment. Keep the token private.

Required CircleCI values:

~~~text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
~~~

The repository's Wrangler environments are:
- `staging` → `nextaction-staging`
- `production` → `nextaction`

Cloudflare secrets should be stored as Worker secrets rather than plaintext Worker variables.

Reference:
https://developers.cloudflare.com/workers/configuration/secrets/

## 3. CircleCI contexts

Stage 14 release jobs now use three least-privilege contexts:

~~~text
nextaction-cloudflare
nextaction-staging
nextaction-production
~~~

Create those contexts in CircleCI Organization Settings → Contexts.

Add these variables to `nextaction-cloudflare`:

~~~text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
~~~

Add these variables to `nextaction-staging`:

~~~text
STAGING_NEXT_PUBLIC_SUPABASE_URL=https://njjybpswxalxjhqjlvqa.supabase.co
STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
STAGING_SUPABASE_SECRET_KEY=<staging secret key>
STAGING_INTEGRATION_TOKEN=<token produced by STAGE14_SEED.sql>
~~~

The Stage 14 smoke Moment key is the immutable constant `stage14_smoke_moment`
defined in `scripts/staging-smoke.mjs`; it is intentionally **not** a CircleCI
context variable, so the smoke can never drift from the seeded fixture.

The release workflow captures the actual `workers.dev` URL after the staging deployment and passes it to the staging smoke job. `STAGING_BASE_URL` does not need to be configured manually.

Add these variables to `nextaction-production`:

~~~text
PRODUCTION_NEXT_PUBLIC_SUPABASE_URL=<production Supabase URL>
PRODUCTION_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<production publishable key>
PRODUCTION_SUPABASE_SECRET_KEY=<production secret key>
~~~

Do not commit any of these values to Git.

CircleCI masks stored environment variables; they are configured from the CircleCI web app or contexts.

Reference:
https://circleci.com/docs/guides/security/set-environment-variable/

## 4. Worker URLs

No Worker URL needs to be hard-coded into CircleCI.

After `deploy_staging`, the workflow captures the `workers.dev` URL emitted by Wrangler and passes it to `staging_smoke`.

After `deploy_production`, the workflow does the same for `production_smoke`.

This keeps the deployment URL derived from the actual deployment rather than from manually copied configuration.

## 5. Seed token

The staging database is already provisioned and has the Stage 14 fixture.

The seed script is:

~~~text
supabase/staging/STAGE14_SEED.sql
~~~

It creates a disposable publisher/advertiser topology and prints a fresh Integration token and Delivery token.

The executable staging smoke uses:
- Integration token
- Moment key

It does not need the pre-created Delivery token because `/v1/offer` creates a fresh Delivery during smoke.

If the fixture is reseeded, update `STAGING_INTEGRATION_TOKEN` with the newly generated token.

## 6. Trigger the real release gate

CircleCI's release workflow is opt-in and controlled by:

~~~text
run_release_gate = true
~~~

In CircleCI:
1. Open the NextAction project.
2. Select **Trigger Pipeline**.
3. Select branch `master`.
4. Add pipeline parameter:
   `run_release_gate = true`
5. Start the pipeline.

CircleCI supports passing declared pipeline parameters from the Trigger Pipeline UI.

Reference:
https://circleci.com/docs/guides/orchestrate/pipeline-variables/

Expected sequence:

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
hold_production
  ↓
deploy_production
  ↓
production_smoke
~~~

The production approval job is intentionally manual and must not be bypassed.

## 7. What success means

A successful Stage 14 release gate proves:

~~~text
Cloudflare build
  ↓
real staging Worker
  ↓
Event acceptance
  ↓
Event idempotency replay
  ↓
Moment/Decision/Delivery
  ↓
Click
  ↓
Qualified Click
  ↓
Settlement
  ↓
click replay
  ↓
manual production approval
  ↓
production deploy
  ↓
production health
~~~

Production smoke is health-only by design so release validation does not create financial test transactions in production.

## 8. Important security rules

Never put these in Git:
- Cloudflare API token
- Supabase secret/service key
- staging Integration token
- any production secret

Do not use the production Supabase project as the staging settlement fixture.

Do not use `ragamstudio` as NextAction staging.

