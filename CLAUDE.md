# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fewya is a modern marketplace PWA where small businesses can sell professionally and easily, similar to Wallapop/Vinted but without complexity. The buyer experience is mobile-first; the seller section is desktop-focused. Both share code infrastructure for efficiency.

**Key Concept:** "Amazon dehumanizes the seller. Wallapop overhumanizes the transaction." Fewya separates buyer and seller experiences while keeping them discoverable through one marketplace.

## Tech Stack

- **Framework:** Astro 6.0.8 (SSR enabled for Cloudflare Workers)
- **Language:** TypeScript 5.9.3
- **Styling:** Tailwind CSS 4.2.1
- **Package Manager:** Bun
- **Database:** Supabase (PostgreSQL) with @supabase/ssr for SSR cookie-based sessions
- **Authentication:** Supabase Auth (currently Google OAuth)
- **Payments:** Stripe with Stripe Connect for seller payouts
- **Shipping:** Sendcloud integration (Spain-focused with service points)
- **PWA:** vite-plugin-pwa with Workbox (offline-first, auto-update)
- **Deployment:** Cloudflare Workers with wrangler v4
- **Testing:** Vitest v4 (happy-dom environment) with coverage via v8
- **Linting:** ESLint 10.0.3 with @typescript-eslint and eslint-plugin-astro
- **Code Quality:** simple-git-hooks with lint-staged for pre-commit checks

## Project Structure

```
src/
├── pages/                    # Astro file-based routing
│   ├── api/                 # API routes (Astro server endpoints)
│   │   ├── auth/            # Auth flows (login, logout, callback)
│   │   ├── cart/            # Checkout endpoints
│   │   ├── orders/          # Order management
│   │   ├── sell/            # Seller endpoints
│   │   ├── sendcloud/       # Shipping integration
│   │   └── wishlist/        # Wishlist toggling
│   ├── sell/                # Seller dashboard pages (file-based routing)
│   ├── me/                  # Buyer profile pages
│   ├── [shopSlug]/          # Shop pages (dynamic)
│   ├── cart/                # Checkout flow
│   ├── search/              # Product search
│   └── wishlist/            # Wishlist page
├── components/              # Astro components
│   ├── seller/              # Seller-specific UI
│   ├── product/             # Product detail components
│   ├── cart/                # Checkout UI
│   ├── orders/              # Order history UI
│   ├── search/              # Search UI
│   ├── settings/            # Settings forms
│   ├── icons/               # Icon components
│   └── *.astro              # Shared UI (Header, Footer, ProductCard, etc.)
├── layouts/
│   ├── Layout.astro         # Base layout with auth checking
│   ├── BuyerAppLayout.astro # Buyer-specific layout (bottom nav, mobile-first)
│   ├── SellerLayout.astro   # Seller-specific layout (sidebar, desktop-first)
│   └── BuyerDetailLayout.astro
├── lib/                     # Reusable utilities and business logic
│   ├── core/                # Core infrastructure
│   │   ├── auth.ts          # Supabase SSR auth, session management, OAuth flow
│   │   ├── supabase.ts      # Supabase client singleton
│   │   ├── supabase-admin.ts # Admin client (secret key, server-only)
│   │   ├── types.ts         # Shared type definitions (User, Shop, Product, etc.)
│   │   ├── validation.ts    # User/profile validation helpers
│   │   └── i18n.ts          # Spanish string constants
│   ├── cart/                # Cart and checkout logic
│   │   ├── cart.ts          # Server-side cart utilities
│   │   ├── cart-client.ts   # Client-side cart state (Astro island)
│   │   └── checkout.ts      # Checkout pricing, payout breakdown, currency conversion
│   ├── payments/
│   │   └── stripe.ts        # Stripe client, Stripe Connect (connected accounts)
│   ├── products/
│   │   ├── productUtils.ts  # Product enrichment (ratings, availability)
│   │   ├── productValidation.ts # Completeness checks, checkout readiness
│   │   └── search.ts        # Product search filters
│   ├── orders/
│   │   └── orderStatus.ts   # Order state machine (pending, shipped, delivered, etc.)
│   ├── shipping/
│   │   ├── sendcloud.ts     # Sendcloud API client (rates, labels, tracking)
│   │   ├── shippingLabelPdf.ts # PDF generation for shipping labels (pdf-lib)
│   │   ├── countries.ts     # Country metadata
│   │   └── spain-provinces.ts # Spain provinces for regional shipping
│   ├── wishlist/            # Wishlist sync (logged-in + local storage)
│   │   ├── wishlist.ts      # Server-side wishlist merge
│   │   ├── wishlist-client.ts # Client-side actions
│   │   └── wishlist-local.ts # Local storage fallback
│   ├── ui/                  # UI helper functions
│   │   ├── buyerShell.ts    # Buyer layout utilities
│   │   ├── nav.ts           # Navigation state
│   │   └── seller-nav.ts    # Seller navigation
│   └── styles/              # Global Tailwind styles
├── types/
│   └── pdf-lib.d.ts         # Type definitions for pdf-lib
├── middleware.ts            # Auth code exchange (SSR auth redirect flow)
└── env.d.ts                 # Astro environment types

tests/
├── unit/                    # Vitest unit tests
│   ├── *.test.ts            # Test files mirror src/ structure
│   └── coverage/            # Coverage reports (v8)
└── mocks/
    └── astro-env-server.ts  # Mock for astro:env/server (testing only)

db-structure/               # Database schema documentation
└── *.sql                   # Migration files

public/                     # Static assets (favicon.svg, manifest)
```

## Key Architecture Patterns

### SSR with Astro & Cloudflare

- **Output:** `output: 'server'` - all pages are server-rendered on Cloudflare Workers
- **Adapter:** `@astrojs/cloudflare` with Node.js compat v2
- **Auth Flow:** Middleware-driven OAuth with cookie-based sessions
- **Environment:** env schema in astro.config.mjs with public/secret split

### Authentication & Sessions

1. **SSR Session Management**: Supabase @supabase/ssr with cookie integration
2. **Auth Flow:**
   - User initiates OAuth (Google) → redirects to `/api/auth/login`
   - Supabase redirects back to `/api/auth/callback` with code
   - Middleware intercepts GET requests, exchanges code for session
   - Redirects to stored path or role-based default (seller/buyer)
   - First-time users redirect to `/me/details` for profile completion
3. **Role-Based Redirect:** Cookies store `fewya-auth-redirect` and `fewya-auth-role` during flow
4. **Auth Helpers:**
   - `createSupabaseAuthClient()` - creates server client for each request (SSR)
   - `exchangeAuthCodeForSession()` - handles OAuth callback logic
   - `isProfileComplete()` - validates profile before checkout

### Data Fetching & Type Safety

- **Supabase:** Direct query builder with TypeScript inference from DB schema
- **Queries:** Executed server-side (in page/api routes) with full access to secrets
- **Pattern:** Load data in Astro page frontmatter, pass to components as props
- **Admin Access:** `supabase-admin.ts` uses secret key for privileged operations (order updates, payouts)

### Cart & Checkout

1. **Server-Side Logic** (`lib/cart/checkout.ts`):
   - `buildShopPayouts()` - aggregates items by shop, calculates subtotal/shipping
   - `toMinorUnits()/fromMinorUnits()` - EUR currency conversion (Stripe uses cents)
   - Validates product completeness and availability before payment

2. **Stripe Integration** (`lib/payments/stripe.ts`):
   - Stripe Connect: each seller has a connected account (`stripeAccountId`)
   - Multi-shop checkout: one payment intent per shop to seller's account
   - On success: records order in DB with payout breakdown

3. **Checkout API** (`pages/api/cart/checkout.ts`):
   - POST endpoint validates delivery address, items, inventory
   - Calls Stripe.checkout.sessions.create with list of shop sessions
   - Returns checkout URL or error

### Product Management

- **Completeness:** Products must have title, description, price, variants, image, and active shop
- **Validation:** `isProductComplete()` used in product listing and checkout
- **Ratings:** Enriched on-demand via `enrichProductsWithRatings()` (async aggregation from orders)
- **Search:** Full-text search with filters (category, price range, seller)

### Shipping Integration (Sendcloud)

- **Spain-Focused:** Default country ES, with regional service points
- **Workflow:**
  1. Get rates: `POST /api/sendcloud/quote` - validates address, returns carrier options
  2. Create shipment: `POST /api/sendcloud/shipment` - reserves label
  3. Generate PDF: `GET /api/sendcloud/label` - renders Sendcloud label as PDF
  4. Tracking: Sendcloud webhook posts to `/api/sendcloud/webhook` for status updates
- **Label PDF:** Uses pdf-lib to embed barcode and carrier info
- **Service Points:** Sendcloud API returns pickup points for buyer selection

### Order Lifecycle

- **State Machine** (`lib/orders/orderStatus.ts`): `pending` → `shipped` → `delivered` (or `refunded`)
- **Confirmation:** Auto-confirmed after 14 days (Sendcloud webhook or manual override)
- **Dispute:** Buyers can report incidents with photos (`POST /api/orders/incident-upload`)
- **Refunds:** Seller can refund; deducted from payout

### Wishlist Sync

- **Hybrid Storage:** Logged-in users sync with DB; anonymous users use localStorage
- **Merge:** On login, merge localStorage wishlist with DB
- **Toggle:** `POST /api/wishlist/toggle` - adds/removes product from DB wishlist

### PWA & Offline

- **vite-plugin-pwa:** Auto-generated service worker with Workbox runtime caching
- **Strategy:** Network-first for navigation (3s timeout), cache fallback for assets
- **Manifest:** Generated from config (name, icons, theme color)
- **Development:** Enabled in dev mode with suppressWarnings to test offline

## Development Commands

### Setup & Installation

```bash
bun install          # Install dependencies (Bun lock file in repo)
```

### Development

```bash
bun run dev          # Start Astro dev server (hot reload on port 3000)
bun run start        # Alias for dev
```

### Building & Deployment

```bash
bun run typegen      # Generate Cloudflare Worker types from wrangler.jsonc
bun run build        # Full build: typegen + type check + bundle (produces dist/)
bun run preview      # Preview built site locally (uses wrangler)
```

### Testing

```bash
bun run test         # Run all tests once (vitest run)
bun run test:watch   # Watch mode for tests (vitest)
bun run test:changed # Run only tests for changed files (vitest --changed)
bun run test:coverage # Generate coverage report (v8 reporter: text, json, html)
```

### Code Quality

```bash
bun run lint         # Lint all TypeScript and Astro files (eslint .)
bun run lint:fix     # Auto-fix linting errors (eslint . --fix)
```

### Type Checking

```bash
bun run check        # Astro type check for .astro files and TypeScript
```

### Pre-Commit Hooks

The repo uses `simple-git-hooks` with `lint-staged`:
- **Pre-commit:** Runs lint-staged (eslint --fix + vitest on changed files) + full type check
- **Pre-push:** Runs full test suite
- These are automatic on commit/push; skip with `git commit --no-verify` (not recommended)

## Code Standards (from AGENTS.md)

1. **Modularity:** Components and utilities split into separate files when reusable or complex
2. **Scalability:** Design for future growth; avoid hardcoding values
3. **Explanations:** Always explain changes in commit messages and chat
4. **i18n:** Use `strings` object from `lib/core/i18n.ts` for all user-facing text (Spanish strings)
5. **Routes:** All page routes in English; internal data uses Spanish for user-facing strings
6. **Database:** Update `db-structure/` and create migration SQL in `supabase/migrations/` on schema changes

## Configuration Files

- **astro.config.mjs:** Cloudflare adapter, env schema, Tailwind+PWA plugins
- **tsconfig.json:** Extends Astro strict config; includes vitest globals, PWA client types
- **vitest.config.ts:** happy-dom environment; aliases `astro:env/server` to test mock; excludes pages/layouts/components/styles from coverage
- **eslint.config.mjs:** TypeScript + Astro rules; unused vars error (except `_` prefix); laxer rules for tests
- **wrangler.jsonc:** Cloudflare Worker config; Sendcloud sender info as vars; observability enabled

## Environment Variables

**Build-time** (resolved at build, set in CI or `.env`):
- `SUPABASE_URL` - Database URL
- `SUPABASE_KEY` - Public anon key

**Runtime secrets** (set as Wrangler secrets on Cloudflare):
- `SUPABASE_SECRET_KEY` - Service role key (secret_... format, not legacy JWT)
- `STRIPE_SECRET_KEY` - Stripe test/live key
- `SENDCLOUD_API_KEY`, `SENDCLOUD_API_SECRET` - Sendcloud credentials
- `SENDCLOUD_WEBHOOK_SECRET` - Webhook signature validation

**Sendcloud vars** (wrangler.jsonc):
- Sender address, city, postal code, country, phone, email, company name

## Common Tasks & Patterns

### Adding a New API Endpoint

1. Create `src/pages/api/[feature]/[action].ts`
2. Use `APIRoute` type for route handler
3. Auth via `createSupabaseAuthClient()` in request context
4. Return JSON with `new Response(JSON.stringify(payload), { status, headers })`
5. Add tests in `tests/unit/[feature].test.ts`

### Adding a New Page

1. **Buyer:** Create `.astro` in `src/pages/` or subdirectory, import `BuyerAppLayout`
2. **Seller:** Import `SellerLayout`
3. Fetch data in frontmatter using `createSupabaseAuthClient()`
4. Pass to components as props
5. Use Tailwind for styling; dark mode via `dark:` prefix

### Adding a Product Feature

1. Define types in `lib/core/types.ts`
2. Add validation in `lib/products/productValidation.ts`
3. Create form component in `src/components/product/`
4. Add API route if user input needed
5. Update DB schema + migration if new columns required

### Testing Strategy

- Unit tests for utilities (`lib/` functions): test inputs/outputs, edge cases
- Mock Supabase/Stripe responses; use `astro-env-server` mock for env
- API route tests: mock request/response, verify JSON output
- No snapshot tests; prefer explicit assertions
- Coverage targets: utilities (100%), pages/components (smoke tests only)

## Debugging Tips

- **Dev Server Logs:** Astro outputs to terminal; check for Supabase/Stripe errors
- **Cookies:** Inspect browser DevTools → Application → Cookies for auth cookies
- **Astro Errors:** Clear `.astro/` cache if type mismatches persist
- **Wrangler Preview:** Use `bun run preview` to test Cloudflare Worker behavior locally
- **Supabase:** Check RLS policies if 403 errors on queries
- **Stripe:** Use test keys (sk_test_); webhook testing via Stripe CLI

## Important Notes

- **Always use secret key when available** (`supabase-admin.ts` for privileged DB ops)
- **No API keys in code:** Use env vars and wrangler secrets
- **Mobile-first for buyer, desktop-first for seller:** Tailor Tailwind breakpoints (`sm:`, `lg:` etc.)
- **Stripe Connect:** Each shop session goes to seller's connected account, not Fewya's
- **Timezone handling:** Supabase stores UTC; format dates on client side for user's locale
