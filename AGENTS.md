# Fewya — Agent Instructions

## Project

Fewya is a marketplace PWA for small businesses. The buyer experience is a mobile-first PWA (think native app, not a website); the seller dashboard is desktop-first. Both share the same codebase.

### Vision

- A marketplace where small businesses can sell professionally — easier than running their own site, less commoditised than Amazon.
- The buyer purchases directly with confidence: clear product info, variants, no need to chat.
- "Amazon dehumanises the seller. Wallapop over-humanises the transaction."
- Buy from the seller, not the platform.
- Goal: Democratise eCommerce. Focused on new products, not second-hand.
- The buyer pays for what they see: products + shipping. Commissions and insurance are the seller's responsibility.
- Sellers get management freedom (like Shopify) and full control over their own policies.

---

## Design

**Standard:** Ultramodern minimalist — on par with Notion, OpenAI, Revolut, Apple.

- Always implement light **and** dark mode (`dark:` Tailwind prefix).
- The buyer section must feel like a native mobile app, not a website.
- The seller section prioritises a good desktop experience.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Astro (SSR, Cloudflare Workers adapter) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Deployment | Cloudflare Workers |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth — Google OAuth only (initial) |
| Package manager | Bun |
| Linter | ESLint + `eslint-plugin-astro` |
| PWA | `vite-plugin-pwa` |

---

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

---

## Architecture

### Routing & layouts

All pages are SSR (`output: 'server'`, Cloudflare Workers adapter). Two layout branches:

- **`BuyerAppLayout`** — Header + BottomNav → `/`, `/search`, `/me/*`, `/cart/*`, `/wishlist`, `/:shopSlug/*`
- **`SellerLayout`** — Sidebar → `/sell/*`

Fetch data in Astro frontmatter with `createSupabaseAuthClient(Astro.cookies, Astro.request)`, then pass it as props to components.

### Auth flow

1. `/api/auth/login` → Google OAuth via Supabase; sets `fewya-auth-redirect` + `fewya-auth-role` cookies.
2. Supabase redirects to `/api/auth/callback?code=...`.
3. `middleware.ts` intercepts every GET with a pending auth state, calls `exchangeAuthCodeForSession()`, then redirects.
4. New buyers (account created within 60s of first sign-in) → `/me/details` for profile completion.

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
- **`validateCheckoutReadiness()`** — narrow check (active, has title, variant price > 0, stock ≥ quantity, shipping_cost ≥ 0). Used in the checkout API; does not fetch description/category/dimensions.

### Order state machine

```
pending → paid → processing → shipped → delivered → confirmed
                                              ↓
                                          incident → (resolved) → confirmed
                               cancelled (from pending/paid)
```

Status labels come from `getOrderStatusLabels(t)` in `lib/orders/orderStatus.ts` (callers pass the active `t` from `Astro.locals`).

### Wishlist

Anonymous users: localStorage (`wishlist-local.ts`). On login: localStorage items merge into DB (`wishlist.ts`). Toggle endpoint: `POST /api/wishlist/toggle`.

### Client-side UI utilities (`lib/ui/`)

Thin vanilla-TS helpers used inside `<script>` blocks in Astro components:

| File | Purpose |
|---|---|
| `toast.ts` | Show transient feedback messages |
| `busy.ts` | Disable/enable form elements during async ops |
| `submit.ts` | Form submission with loading state |
| `live-status.ts` | Poll or update status indicators in-place |
| `progress-bar.ts` | Top-of-page navigation progress indicator |
| `nav.ts` / `seller-nav.ts` | Active nav item detection |

---

## Code Standards

- **Efficiency:** Less code = fewer bugs. Always choose the smartest, most scalable solution.
- **Modularity:** Separate files for components and functions that are reusable or complex enough to warrant it.
- **i18n:** All user-facing strings go in `lib/core/i18n/` (Spanish + English). Never hardcode UI text. The active locale is resolved in `middleware.ts` (cookie override → `Accept-Language` → `en` default) and exposed on `Astro.locals` as `locale` and `t`. In `.astro` frontmatter, pull strings with `const { t, locale } = Astro.locals;`. Server-side helpers in `lib/` accept `t` (a `Strings` object) as a parameter; client-side modules call `getClientT()` from `lib/core/i18n/client.ts` which reads the `__fewyaT__` global injected by `Layout.astro`. Adding a new key: add it to `strings.es.ts` AND `strings.en.ts` (and the `Strings` interface in `types.ts` — TypeScript will catch mismatches). To add a new locale, extend `SUPPORTED_LOCALES` in `locales.ts` and add a new strings file.
- **Page routes:** English only (e.g., `/sell/catalog`, `/me/orders`).
- **Types:** Shared domain types (`Shop`, `Product`, `ProductVariant`, `Review`) live in `lib/core/types.ts`.
- **Unused vars:** Prefix with `_` to suppress ESLint errors.
- **DB changes:** Update the relevant file in `db-structure/` **and** always write the SQL in `.migrations/<YYYY-MM-DD-description>.sql`. Then apply it to Supabase using `mcp__supabase__apply_migration` and report in chat whether it succeeded or failed.
- **Git:** NEVER commit, push, or alter git history unless explicitly asked. When asked to commit, follow Git best practices (atomic commits per responsibility/category). Always write commit messages in English.
- **Always explain** in chat what you've done and suggest improvements or flag bad practices you find.

---

## Environment Variables

**Build-time** (`.env` or CI):
- `SUPABASE_URL`, `SUPABASE_KEY` — public Supabase credentials

**Runtime secrets** (`wrangler secret put <NAME>`):
- `SUPABASE_SECRET_KEY` — service role key (`sb_secret_...` format)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SENDCLOUD_API_KEY`, `SENDCLOUD_API_SECRET`, `SENDCLOUD_WEBHOOK_SECRET`

Sendcloud sender address/contact are plain `vars` in `wrangler.jsonc` (not secrets).

---

## Testing

- Unit tests only cover `lib/` utilities. Pages, layouts, and components are excluded from coverage.
- `astro:env/server` is aliased to `tests/mocks/astro-env-server.ts` in `vitest.config.ts` — import this mock's exports when testing code that reads env vars.
- Mock Supabase/Stripe inline; no snapshot tests; prefer explicit assertions.
