# Fewya

Fewya is a marketplace for small businesses: sellers manage a storefront,
catalog, orders, shipping, and payouts while buyers browse and check out from a
mobile-friendly web app.

The current application is an Astro SSR app deployed to Cloudflare Workers. It
uses Convex and Clerk in the isolated test deployment while the production
rollout still retains the Supabase compatibility path. The migration status and
cutover gates are documented in [`docs/supabase-to-convex.md`](docs/supabase-to-convex.md).

## Stack

- Astro and TypeScript, with Tailwind CSS
- Convex and Supabase during the staged data migration
- Clerk authentication with Convex JWTs
- Stripe Connect payments and Sendcloud shipping
- Resend email and Web Push notifications
- Cloudflare Workers, with a PWA service worker for supported clients

## Local development

Requirements: [Bun](https://bun.sh), the credentials listed in
[`.env.example`](.env.example), and access to the required external services.

```bash
git clone https://github.com/martinezharo/fewya.git
cd fewya
bun install
cp .env.example .env
bun run dev
```

The development server runs at `http://localhost:4321` by default.

Useful checks:

```bash
bun run check
bun run lint
bun run test
bun run build
```

## Deployment

Configure Worker secrets with Wrangler, then build and deploy the selected
environment:

```bash
CLOUDFLARE_ENV=production bun run build
bunx wrangler deploy
```

The test Worker is `fewya-test`; its environment is Convex-only, uses test
payment keys and mocked shipping, and has no scheduled cron trigger. See
[`wrangler.jsonc`](wrangler.jsonc) for environment bindings and deployment
details.

## Public catalog feed

Each shop can expose its public catalog without exposing inventory quantities:

```text
GET /api/public/shops/<shopSlug>/catalog.json
```

The endpoint is anonymous, read-only, cacheable, and returns the same public
product fields shown on the storefront.

## License

[AGPL-3.0](LICENSE)
