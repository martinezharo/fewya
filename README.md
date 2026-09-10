# Fewya

Fewya is a marketplace for small businesses: sellers manage a storefront,
catalog, orders, shipping, and payouts while buyers browse and check out from a
mobile-friendly web app.

The current application is an Astro SSR app deployed to Cloudflare Workers,
with Convex as its only database and Clerk for authentication. How the data got
there, and what remains to switch production traffic over, is documented in
[`docs/supabase-to-convex.md`](docs/supabase-to-convex.md).

## Stack

- Astro and TypeScript, with Tailwind CSS
- Convex for data, file storage and authorization
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
bun run test       # unit tests plus the Convex authorization suite
bun run build
```

`tests/convex/` runs the real Convex functions against an in-memory deployment.
That is where authorization is asserted — one tenant must never reach another's
documents — since the rules live in the functions rather than in database
policies.

## Deployment

Deploy to Cloudflare Workers. Set secrets via `bunx wrangler secret put <NAME>`, then:

```bash
CLOUDFLARE_ENV=production bun run build && bunx wrangler deploy
```

Convex functions deploy separately from the Worker:

```bash
bunx convex deploy          # production deployment
bunx convex dev             # staging/development deployment
```

See [`wrangler.jsonc`](wrangler.jsonc) for bindings and environments. The test worker (`fewya-test`) runs on `*.workers.dev` with mocked shipping and Stripe test keys, points at the staging Convex deployment, and has no scheduled cron trigger.

## Public catalog feed

Each shop can expose its public catalog without exposing inventory quantities:

```text
GET /api/public/shops/<shopSlug>/catalog.json
```

The endpoint is anonymous, read-only, cacheable, and returns the same public
product fields shown on the storefront.

## License

[AGPL-3.0](LICENSE)
