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
