<div align="center">

# Fewya

**A modern marketplace for small businesses to sell online — professionally and simply.**

[![Astro](https://img.shields.io/badge/Astro-6.0-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.2-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F48120?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Stripe](https://img.shields.io/badge/Stripe-Connect-635BFF?logo=stripe&logoColor=white)](https://stripe.com)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](#license)

</div>

---

## Overview

Fewya empowers small businesses to sell products online with a professional storefront — without building their own website or selling on Amazon.

- **Buyers** get a mobile-first PWA with instant checkout and real-time tracking.
- **Sellers** get a full dashboard to manage products, orders, and shipping.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Astro](https://astro.build) (SSR) |
| **Language** | [TypeScript](https://www.typescriptlang.org) (strict) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) v4 |
| **Database** | [Supabase](https://supabase.com) (production compatibility path) + [Convex](https://convex.dev) (staged migration) |
| **Auth** | [Clerk](https://clerk.com) + Convex JWTs (staged migration; Supabase Auth remains the production compatibility path) |
| **Payments** | [Stripe Connect](https://stripe.com) |
| **Shipping** | [Sendcloud](https://www.sendcloud.com) |
| **Email** | [Resend](https://resend.com) |
| **PWA** | [vite-plugin-pwa](https://github.com/kevinmarrec/vite-plugin-pwa) + Workbox |
| **Deploy** | [Cloudflare Workers](https://workers.cloudflare.com) |
| **Runtime** | [Bun](https://bun.sh) |
| **Testing** | [Vitest](https://vitest.dev) |

## Getting Started

```bash
git clone https://github.com/martinezharo/fewya.git
cd fewya
bun install
cp .env.example .env   # fill in your values
bun run dev             # → http://localhost:4321
```

See [`.env.example`](.env.example) for all required variables.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev server with hot reload |
| `bun run build` | Type-check + production build |
| `bun run preview` | Preview production build |
| `bun run test` | Run tests |
| `bun run test:watch` | Tests in watch mode |
| `bun run lint` | Lint codebase |
| `bun run check` | Type generation + Astro check |

## Deployment

Deploy to Cloudflare Workers. Set secrets via `bunx wrangler secret put <NAME>`, then:

```bash
CLOUDFLARE_ENV=production bun run build && bunx wrangler deploy
```

See [`wrangler.jsonc`](wrangler.jsonc) for bindings and environments. The isolated test worker (`fewya-test`) uses Convex-only with Clerk authentication, test payment keys and mocked shipping, and has no scheduled cron trigger.

## Public catalog feed

Sellers can mirror their own Fewya listings on their own site without touching the
database:

```
GET /api/public/shops/<shopSlug>/catalog.json
```

Anonymous, cacheable and read-only. It returns what the public product pages
already show — title, description, images, brand, price and an `in_stock`
boolean. Exact inventory levels are deliberately not exposed, and shops that
cannot currently sell return 404 so the feed never leaks onboarding state.

## Contributing

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Add tests for new logic
3. Run `bun run lint && bun run test` before submitting a PR

Git hooks run lint-staged (ESLint + related tests) on pre-commit, and type check + full test suite on pre-push.

## License

This project is open source. See [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ by [Oli](https://olivermartinezharo.com)

</div>
