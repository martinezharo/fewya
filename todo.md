# Fewya — Project Review TODO

Generated from a full-codebase pass (auth/security, checkout/payments/orders, UI/UX/accessibility/i18n,
performance/DB/testing). Items are grouped by area and roughly ordered by urgency within each group.

---

## 🔴 Critical bugs (money / data integrity)

- [x] **Silent stock-conflict failure after payment captured** — `src/pages/api/webhooks/stripe.ts`.
      Fixed: when `mark_order_paid` fails, the handler now refunds the payment intent (idempotent per session)
      and cancels the affected order(s) instead of just logging and moving on.
- [x] **Missing idempotency key on seller-initiated cancellation refund** — `src/pages/api/orders/refund.ts`.
      Fixed: added an `idempotencyKey`, matching the other refund/transfer call sites.
- [x] **Orphaned "pending" orders on partial multi-shop checkout failure** — `src/pages/api/cart/checkout.ts`.
      Fixed: orders already created for other shops in the same checkout attempt are now cancelled when a later
      shop's order creation fails.
- [x] **Shipping cost read live instead of frozen at order time** — `src/lib/orders/orderJoins.ts` /
      `src/lib/orders/payoutFlow.ts`. Fixed in code: added `order_items.shipping_cost_at_purchase`, populated at
      checkout, with payout/refund code preferring it over the live variant value (falling back to the live value
      only for orders that predate the column). **⚠️ The DB migration
      (`.migrations/2026-07-02-freeze-shipping-cost-at-purchase.sql`) has NOT been applied to Supabase yet** — no
      Supabase MCP tool was available in the session that made this fix. It must be applied before/with deploying
      that commit, or `refund-incident`, `resolve-delivery-failure`, and fund release will error on the missing
      column.

## 🟠 Security

- [x] **Open-redirect bypass in auth flow** — `src/lib/core/auth.ts` (`normalizeAuthRedirectPath`). Fixed: now
      also rejects `/\`-prefixed paths, which browsers normalize to a protocol-relative `//` redirect.
- [ ] **`profiles` RLS policy is `FOR ALL` on the whole row** — `db-structure/00-base.sql:267`. Lets an authenticated
      user write *any* column on their own row via direct REST/JS client access, not just the fields exposed by
      `profile/update.ts`. No exploit today, but it's a latent risk if a sensitive/admin-controlled column is added
      later (e.g. a verification flag) without a matching column-level restriction. Consider column-level grants or
      a trigger that rejects changes to protected columns.
- [ ] **CSP allows `script-src 'unsafe-inline'`** — `src/middleware.ts:27`. Documented trade-off for Astro's
      ClientRouter re-execution, but materially weakens XSS mitigation. Worth revisiting with nonces/hashes if the
      ClientRouter constraint can be worked around.
- [ ] No ownership pre-check before Stripe account lookups in `confirm-delivery.ts` / `cancel-incident.ts` — any
      authenticated user can trigger a Stripe `accounts.retrieve` call for an arbitrary order id before the
      (correctly enforced) ownership check happens inside the state-changing RPC. Not exploitable for state changes,
      but needless Stripe API exposure/rate-limit surface. Add an early ownership check.

## 🟡 Performance & database

- [ ] **Missing indexes on hot foreign keys**:
  - `product_variants.product_id` (`db-structure/01-catalog.sql:36-52`) — joined on every product page, cart, and search.
  - `shipments.order_id` (`db-structure/03-shipping.sql:26-45`) — used by `get_order_shipment()` and every order page.
  - `shipment_tracking.shipment_id` (`db-structure/03-shipping.sql:48-59`) — used in RLS policy and tracking sync.
  - `reviews.product_id` (`db-structure/04-social.sql:6-19`) — only has a partial unique index (`WHERE is_auto=true`);
    add a plain index for rating aggregation/cascade queries.
- [ ] **`wishlist` has no `UNIQUE(profile_id, product_id)` constraint** (`db-structure/04-social.sql:24-32`) — duplicate
      wishlist rows are currently possible; add the constraint plus an index on `product_id`.
- [ ] **Unbounded fetches with no pagination** — will degrade as data grows:
  - `src/components/home/DeferredHomeGrid.astro:18-23` — fetches *all* active products (search already limits to 80).
  - `src/components/orders/DeferredBuyerOrders.astro` and `DeferredSellerOrders.astro` — full order history with deep
    joins, no `.limit()`/`.range()`.
  - `src/pages/sell/catalog/index.astro:33-36` — fetches all products for a shop.
  - `src/pages/sell/reviews.astro:63-70` — fetches all reviews for a shop.
- [ ] `.migrations/` is git-ignored by design (local staging area before applying to Supabase via
      `mcp__supabase__apply_migration`), so its absence from git history isn't itself a bug — but it also means
      there's no durable, shared record of past schema changes beyond the current-state snapshot in `db-structure/`.
      Worth deciding whether to track migrations in git after all (e.g. drop the `.gitignore` entry) for auditability.
- [ ] Images missing `width`/`height` (CLS risk): `src/components/ProductCardMinimal.astro:27-33` and
      `src/components/product/ProductGallery.astro:48-53` (desktop main image also has no `loading` attribute).
- [ ] `src/lib/shipping/syncTracking.ts:30-47` fires one Sendcloud API call per open shipment in parallel with no
      concurrency cap — fine today, will spike outbound calls as shipment volume grows. Add a batch/concurrency limit.

## 🟢 UI / UX / Accessibility

- [ ] Icon-only modal close buttons missing `aria-label`: `IncidentModal.astro:17`, `HideOrderModal.astro:16`,
      `ReviewModal.astro:34`, `CancelIncidentModal.astro:16`, `RefundOrderModal.astro:53`. (`VariantShippingModal.astro`
      and `SellerSidebar.astro` do this correctly — copy the pattern.)
- [ ] `ShopForm.astro:38-45` — `<label>` elements aren't linked to their inputs via `for`/`id` (`shop-name`, `shop-slug`),
      breaking screen-reader and click-to-focus association.
- [ ] `src/pages/sell/shop/index.astro:94` — `#banner-trigger` is a clickable `<div>` (image upload) with no
      `role="button"`, `tabindex`, or key handler — unreachable via keyboard.
- [ ] `astro.config.mjs:96` — PWA `navigateFallback: null`, so there's no offline fallback page; a failed navigation
      while offline shows a bare browser error instead of a cached/offline screen.
- [ ] No pagination / "load more" UX on seller catalog, seller reviews, and both buyer/seller order lists (same
      underlying issue as the DB fetches above) — once a shop has hundreds of products/orders this will be slow and
      unwieldy to scroll.

## 🌐 i18n

- [ ] Hardcoded Spanish strings bypassing `t`:
  - `alt="Evidencia"` in `OrderCard.astro:375` and `sell/claims.astro:220` (should reuse `t.incidentPanelPhotosLabel`
    or a new key).
  - `"Mostrando X de Y pedidos"` in `DeferredSellerOrders.astro:283-285` (inline in a `<script>` block).
  - PWA manifest `description` (`astro.config.mjs:59`) is hardcoded Spanish only — acceptable limitation of static
    manifests, but worth a one-line note since it's the only user-facing string outside the i18n system.
- [ ] Currency formatting duplicated ad hoc in 10+ places (manual `toFixed(2)` + comma/`€` string-building) instead of
      a shared helper, e.g. `lib/products/pricingEnforcement.ts:24`, `productValidation.ts:79`,
      `pages/[shopSlug]/[productSlug].astro:76,99,154`, `pages/cart/index.astro:307-329`. Several hardcode `" €"`
      literally, which is wrong for the English locale (should route through a shared `formatCurrency(amount, t)`
      helper instead of ad hoc string building).
- [ ] `strings.es.ts` / `strings.en.ts` key parity was checked and is currently clean (913/913) — worth adding a CI
      check (small script comparing `Object.keys`) so this doesn't silently drift as new keys are added.

## 🧹 Code quality & cleanup

- [ ] Debug `console.log` left in production code paths: `src/lib/shipping/sendcloud.ts:312`,
      `src/pages/api/sendcloud/preview-quote.ts:92-95`, `src/pages/api/sendcloud/order-label-cost.ts:77-185`.
- [ ] `src/pages/api/reviews/submit.ts:44-54` — a first "has the buyer purchased anything" check is fully superseded
      by the product-scoped check right after it (lines 57-64); the first query is dead weight, delete it.
- [ ] `src/pages/api/sitemap.xml.ts:45-60` uses the admin (RLS-bypassing) client to read already-public data
      (active shops/products) — not a security bug since filters are explicit, but should use the RLS-respecting
      client for consistency with the rest of the codebase.
- [x] `AGENTS.md`'s "Cart & checkout" section said "one Stripe Checkout Session per shop" — corrected to describe
      the actual single-combined-session-per-cart architecture.

## ✅ Testing gaps

- [x] Regression tests added alongside the fixes above: `refund.ts` idempotency key, webhook
      `insufficient_stock` refund-and-cancel path (including the sub-case where the compensating refund itself
      fails), shipping-cost-frozen-vs-live fallback in `orderJoins.ts`, and the multi-shop checkout
      partial-failure/rollback path in `cart/checkout.ts`.
### Remaining from the 2026-07-31 testing pass

The middleware, `core/rate-limit.ts` and the ERP/OC items from that pass are
done (PRs #23 here, erp#3, octopus-control#3). Still open, roughly by value:

- [ ] **Storage RLS.** The 16 policies in `db-structure/06-storage.sql` have no
      tests. `tests/db/bootstrap.sql` already stubs `storage.objects`,
      `storage.buckets` and `storage.foldername`, so this is a new file in
      `tests/rls/` and nothing else — the harness is ready for it.
- [ ] **E2E for checkout and seller sign-up.** Playwright is available. Only
      those two flows; they are the ones where a break costs money directly.
- [ ] **Contract test for `/api/public/shops/[shopSlug]/catalog.json`.** This is
      the boundary with Octopus Control, which mirrors the feed and now shares
      one validator for it (octopus-control#3). A change to the shape here
      unlists that whole site, and nothing on this side would notice.
- [ ] `lib/shops/shopStatus.ts` and `lib/notifications/scan.ts` have no tests.
- [ ] Zero test coverage on: `lib/notifications/scan.ts`, `lib/shipping/syncTracking.ts`, `lib/orders/autoConfirm.ts`,
      `lib/orders/autoReview.ts`, `lib/orders/payoutFlow.ts`, `lib/payments/payoutValidation.ts`,
      `lib/products/pricingEnforcement.ts`, `lib/products/productUtils.ts`, `lib/products/search.ts`,
      `lib/shipping/shipmentStatus.ts`, `lib/shipping/shippingLabelPdf.ts`, `lib/wishlist/*`. Also very low coverage:
      `core/auth.ts` (12%), `notifications/push.ts` (0%), `notifications/resend.ts` (7%), `core/supabase-admin.ts` (0%).
- [ ] No route-level tests exist for `src/pages/api/orders/*` covering illegal state transitions (e.g. can a shipped
      order be moved back to `paid`?) — only `orderStatus.test.ts` covers labels, not transition legality.

## 💡 Feature ideas worth considering

- [ ] **Order tracking push notifications for buyers** — infra already exists (`lib/notifications/`, web push), but
      confirm buyers get proactively notified on every state change (shipped/delivered/incident), not just sellers —
      strengthens the "buy with confidence, no need to chat" vision from AGENTS.md.
- [ ] **Seller analytics dashboard** — basic sales-over-time, best-selling variants, and conversion-from-views widgets
      would fit the "Shopify-like management freedom" goal and differentiate from a bare CRUD seller panel.
- [ ] **Saved searches / back-in-stock alerts** — ties into the existing wishlist infra; notify a buyer when a
      wishlisted or previously-viewed out-of-stock product becomes available again.
- [ ] **Guest checkout** — currently checkout appears to require a signed-in buyer; consider whether allowing guest
      checkout (email-only) would reduce cart abandonment, consistent with the "no need to chat, buy with confidence"
      positioning — worth validating against the added complexity of order lookup/claim-later flows.
- [ ] **Bulk product operations for sellers** — CSV import/export or bulk price/stock edits, especially valuable once
      the "no pagination" catalog issue above is fixed, since sellers with large catalogs will want batch tools.
- [ ] **Review photos moderation / reporting** — reviews currently store buyer-submitted photos; consider basic
      reporting/flagging for sellers if this isn't already present, to protect against abusive review content.

---

*Reviewed: 2026-07-02. Findings verified by reading the referenced source directly; line numbers may drift slightly
as the code changes. All 4 critical bugs and the open-redirect security issue were fixed the same day (separate
commits, each with regression tests) — see the ⚠️ note on the shipping-cost fix for a pending manual step.*
