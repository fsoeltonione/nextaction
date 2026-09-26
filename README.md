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

The application keeps the existing Next.js build path while Stage 14 validates Cloudflare compatibility. Cloudflare currently recommends vinext for Next.js on Workers; Stage 14 runs `vinext check` in the release gate before deployment. OpenNext remains the deployment adapter in this stage to minimize application-toolchain changes while compatibility is validated.

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

Required smoke variables:

```text
STAGING_INTEGRATION_TOKEN
STAGING_MOMENT_KEY
```

Never commit Supabase secrets, Cloudflare API tokens, or `.env` files.

The release workflow is opt-in through the CircleCI `run_release_gate` pipeline parameter. Staging deploy + smoke must pass before the production approval gate can proceed.
