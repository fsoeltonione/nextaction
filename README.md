# NextAction

NextAction is a contextual promotion network for SaaS products.

The core domain chain is:

```text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
```

## Development

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

The application uses Next.js App Router, TypeScript, Tailwind CSS, and Supabase.

## Deployment

The planned production hosting target is Cloudflare.

The repository intentionally does not contain Vercel-specific deployment configuration.

## Source of truth

Product/domain rules, architecture, API contracts, data/security rules, and database migrations are versioned in this repository under `docs/` and `supabase/migrations/`.

## Cloudflare deployment

NextAction targets Cloudflare Workers, not Vercel.

The repository uses an explicit Wrangler environment contract:

- `staging` → `nextaction-staging`
- `production` → `nextaction`

The application keeps the existing Next.js source/runtime semantics while Stage 14 uses vinext for the Cloudflare build/deployment path. Cloudflare currently recommends vinext for Next.js on Workers, and vinext supports both Next.js 16 `proxy.ts` and App Router deployments. The normal `next build` path remains available for application quality checks.

Required deployment variables are provided outside Git:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID

STAGING_NEXT_PUBLIC_SUPABASE_URL
STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
STAGING_SUPABASE_SECRET_KEY

PRODUCTION_NEXT_PUBLIC_SUPABASE_URL
PRODUCTION_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
PRODUCTION_SUPABASE_SECRET_KEY

ANALYSIS_API_KEY
ANALYSIS_BASE_URL
ANALYSIS_MODEL
```

Required smoke variables:

```text
STAGING_INTEGRATION_TOKEN
STAGING_MOMENT_KEY
```

Staging smoke also exercises `POST /api/analyze` through the deployed Worker. NextAction currently uses OpenAgentic.id as its analysis provider. The staging and production deployment contexts must provide `ANALYSIS_API_KEY`, `ANALYSIS_BASE_URL`, and `ANALYSIS_MODEL`. The API key is stored as a Worker secret; the base URL and model are injected as Worker variables. The smoke uses `https://example.com` by default; set `STAGING_ANALYZE_SMOKE_URL` only when a different controlled public fixture is required.

Never commit Supabase secrets, Cloudflare API tokens, or `.env` files.

The release workflow is opt-in through the CircleCI `run_release_gate` pipeline parameter. Staging deploy + smoke must pass before the production approval gate can proceed.


Stage 14 health verification uses a build-time target identity (NEXT_PUBLIC_APP_ENV). The smoke then exercises the real API path separately to prove runtime Supabase credentials and bindings.