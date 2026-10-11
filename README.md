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

```

Required staging smoke variable:

```text
STAGING_INTEGRATION_TOKEN
```

The Stage 14 smoke uses the fixed fixture Moment key `stage14_smoke_moment`; it is intentionally not configurable through CircleCI context variables.

Product URLs are stored as publisher-provided identity/reference data only. The MVP does not crawl publisher websites or call an AI provider to derive product details or Moments. Publishers enter the product name, description, and semantic Moment keys manually; release smoke focuses on the core Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement runtime.

Never commit Supabase secrets, Cloudflare API tokens, or `.env` files.

The release workflow is opt-in through the CircleCI `run_release_gate` pipeline parameter. Staging deploy + smoke must pass before the production approval gate can proceed.


Stage 14 health verification uses a build-time target identity (NEXT_PUBLIC_APP_ENV). The smoke then exercises the real API path separately to prove runtime Supabase credentials and bindings.
## Production release verification

The release gate uses a dedicated production runtime smoke after deployment. It exercises the live production Worker for health, then runs a service-role-only transactional production runtime contract that creates an isolated publisher/advertiser fixture, executes Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement plus settlement replay, verifies the financial ledger and queue drain, and rolls back the entire database subtransaction before returning.

A separate read-only Cloudflare production audit verifies that the active Worker deployment exists, has a valid 100% traffic allocation, and responds from its expected hostname. By default, the release gate checks the deployed production `workers.dev` hostname `nextaction.fsoeltoni-one.workers.dev` using `/api/health`. Set the repository variable `CLOUDFLARE_EXPECTED_HOSTNAME` to a custom hostname to verify its live health endpoint and its Cloudflare Worker Domain mapping.
