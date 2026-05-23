# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Fewya is a marketplace PWA for small businesses. The buyer experience is a mobile-first PWA (think native app, not a website); the seller dashboard is desktop-first. Both share the same codebase.

**Design standard:** Ultramodern minimalist — quality of Notion, OpenAI, Revolut, Apple. Always implement light **and** dark mode (`dark:` Tailwind prefix).

## Commands

```bash
bun run dev              # Dev server with hot reload
bun run build            # typegen + astro check + bundle → dist/
bun run preview          # Run built Worker locally via wrangler

bun run test             # Run all tests once
bun run test:watch       # Watch mode
bun run test:changed     # Only tests affected by changed files
bun run test:coverage    # v8 coverage report
vitest run tests/unit/checkout.test.ts  # Run a single test file

bun run lint             # ESLint on .ts/.astro
bun run lint:fix         # Auto-fix
bun run check            # astro check (type check .astro + TS)
bun run typegen          # Regenerate Cloudflare Worker types from wrangler.jsonc
```

**Pre-commit:** lint-staged runs ESLint + related tests on staged files.  
**Pre-push:** full `bun run check` + `bun run test`.  
After editing hook config in `package.json`, run `bunx simple-git-hooks` to reinstall.

## Architecture

### Routing & layouts

All pages are SSR (`output: 'server'`, Cloudflare Workers adapter). There are two layout branches:
- **`BuyerAppLayout`** — Header + BottomNav, used for all buyer pages (`/`, `/search`, `/me/*`, `/cart/*`, `/wishlist`, `/:shopSlug/*`)
- **`SellerLayout`** — Sidebar, used for all seller pages (`/sell/*`)

Fetch data in Astro frontmatter with `createSupabaseAuthClient(Astro.cookies, Astro.request)`, then pass it as props to components.

### Auth flow

1. `/api/auth/login` → Google OAuth via Supabase, sets `fewya-auth-redirect` + `fewya-auth-role` cookies
2. Supabase redirects to `/api/auth/callback?code=...`
3. `middleware.ts` intercepts every GET with a pending auth state, calls `exchangeAuthCodeForSession()`, then redirects
4. New buyers (account created within 60s of first sign-in) → `/me/details` for profile completion

Use `createSupabaseAuthClient()` (per-request, respects RLS) for user-scoped ops. Use `supabase-admin.ts` (service role key, bypasses RLS) only for privileged server ops (order state transitions, payouts).

### Deferred component pattern

Components prefixed `Deferred*` (e.g., `DeferredHomeGrid`, `DeferredBuyerOrders`) render a skeleton on the server, then fetch and hydrate data client-side via a `<script>` block. Use this pattern for data-heavy sections that would otherwise block page render.

### Cart & checkout

- Cart items are grouped by shop. Shipping cost per shop = **max** shipping cost across items in that shop (not sum).
- One Stripe Checkout Session is created **per shop**, each going directly to the seller's Stripe Connect account.
- `buildShopPayouts()` in `lib/cart/checkout.ts` handles this aggregation.
- Currency: always EUR. Use `toMinorUnits()` / `fromMinorUnits()` for Stripe (cents).
- Payout release via `releaseOrderFunds()` uses `transfer_group` keyed to the order's public ID for idempotency.

### Product validation — two tiers

- **`validateProductCompleteness()`** — full check (title, description, category, slug, photos, valid variant with price/stock/dimensions/shipping). Used for listing readiness.
- **`validateCheckoutReadiness()`** — narrow check (active, has title, variant price > 0, stock ≥ quantity, shipping_cost ≥ 0). Used in the checkout API because it doesn't fetch description/category/dimensions.

### Order state machine

```
pending → paid → processing → shipped → delivered → confirmed
                                          ↓
                                       incident → (resolved) → confirmed
                              cancelled (from pending/paid)
```

Status labels are Spanish strings from `i18n.ts`. The full enum is in `lib/orders/orderStatus.ts`.

### Wishlist

Anonymous users: localStorage (`wishlist-local.ts`). On login: localStorage items merge into DB (`wishlist.ts`). Toggle endpoint: `POST /api/wishlist/toggle`.

### Client-side UI utilities (`lib/ui/`)

These are thin vanilla-TS helpers used inside `<script>` blocks in Astro components:
- `toast.ts` — show transient feedback messages
- `busy.ts` — disable/enable form elements during async ops
- `submit.ts` — form submission with loading state
- `live-status.ts` — poll or update status indicators in-place
- `progress-bar.ts` — top-of-page navigation progress indicator
- `nav.ts` / `seller-nav.ts` — active nav item detection

## Code standards

- **i18n:** All user-facing strings go in `lib/core/i18n.ts` (Spanish). Never hardcode UI text.
- **Page routes:** English only (e.g., `/sell/catalog`, `/me/orders`).
- **DB changes:** Update the relevant file in `db-structure/` **and** create a new migration SQL in `.migrations/` ready to run in Supabase.
- **Unused vars:** Prefix with `_` to suppress the ESLint error.
- **Types:** Shared domain types (`Shop`, `Product`, `ProductVariant`, `Review`) live in `lib/core/types.ts`.

## Environment variables

**Build-time** (`.env` or CI):
- `SUPABASE_URL`, `SUPABASE_KEY` — public Supabase credentials

**Runtime secrets** (`wrangler secret put <NAME>`):
- `SUPABASE_SECRET_KEY` — service role key (`sb_secret_...` format)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SENDCLOUD_API_KEY`, `SENDCLOUD_API_SECRET`, `SENDCLOUD_WEBHOOK_SECRET`

Sendcloud sender address/contact are plain `vars` in `wrangler.jsonc` (not secrets).

## Testing

Unit tests only cover `lib/` utilities. Pages, layouts, and components are excluded from coverage.

`astro:env/server` is aliased to `tests/mocks/astro-env-server.ts` in `vitest.config.ts` — import this mock's exports when testing code that reads env vars.

Mock Supabase/Stripe inline; no snapshot tests; prefer explicit assertions.
