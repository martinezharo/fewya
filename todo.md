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
- [x] **Shipping cost read live instead of frozen at order time.** Settled by the Convex migration: the schema has
      `orderItems.shippingCostAtPurchaseCents`, checkout writes it on every new order, and payouts prefer it over
      the live variant value. The Postgres column was never applied, so imported items have no frozen value and
      fall back to the variant's current shipping cost — harmless, because every imported order is terminal and
      Convex refuses to pay out an imported order at all.

## 🟠 Security

- [x] **Open-redirect bypass in auth flow** — `src/lib/core/auth.ts` (`normalizeAuthRedirectPath`). Fixed: now
      also rejects `/\`-prefixed paths, which browsers normalize to a protocol-relative `//` redirect.
- [x] **`profiles` RLS policy is `FOR ALL` on the whole row.** Moot after the Convex migration: there is no direct
      client access to the database at all, and `users.updateCurrent` accepts a fixed list of fields.
- [ ] **CSP allows `script-src 'unsafe-inline'`** — `src/middleware.ts:27`. Documented trade-off for Astro's
      ClientRouter re-execution, but materially weakens XSS mitigation. Worth revisiting with nonces/hashes if the
      ClientRouter constraint can be worked around.
- [x] No ownership pre-check before Stripe account lookups in `confirm-delivery.ts` / `cancel-incident.ts`. Fixed by
      the Convex migration: both routes now read the payout context through an authorized query that refuses a
      foreign order id, so Stripe is never called for an order the caller does not own.

## 🟡 Performance & database

- [x] **Missing indexes on hot foreign keys** and **`wishlist` uniqueness**. Both are gone with Postgres: the Convex
      schema declares an index for every relationship it queries, and `wishlist.toggle` looks a row up before
      inserting.
- [ ] **Unbounded fetches with no pagination** — will degrade as data grows:
  - `orders.listMine` and `orders.listForShop` — full order history, no pagination.
  - `seller.current` — every product and order of the shop in one query, to render the dashboard.
  - `catalog.listHomeProducts` is capped at 80, but several Convex queries still `collect()` a whole table before
    filtering, which is the same problem one layer down.
- [x] `.migrations/` is git-ignored, and now holds only the exported Supabase snapshot (personal data — it must stay
      out of git). Schema history lives in `convex/schema.ts` and its deploy log.
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
- [x] The duplicated purchase check in `reviews/submit.ts` and the admin client in `sitemap.xml.ts` are both gone:
      the route now delegates to `reviews.submitBatch`, and the sitemap reads a public Convex query.
- [x] `AGENTS.md`'s "Cart & checkout" section said "one Stripe Checkout Session per shop" — corrected to describe
      the actual single-combined-session-per-cart architecture.

## ✅ Testing gaps

- [x] Regression tests added alongside the fixes above: `refund.ts` idempotency key, webhook
      `insufficient_stock` refund-and-cancel path (including the sub-case where the compensating refund itself
      fails), shipping-cost-frozen-vs-live fallback in `orderJoins.ts`, and the multi-shop checkout
      partial-failure path in `cart/checkout.ts` (one atomic Convex write now replaces the rollback).
### Remaining from the 2026-07-31 testing pass

The middleware, `core/rate-limit.ts` and the ERP/OC items from that pass are
done (PRs #23 here, erp#3, octopus-control#3). Still open, roughly by value:

- [x] **Storage authorization.** Replaced by Convex Storage: uploads go through authorized mutations, and label and
      incident files are only handed out to the buyer or seller of the order (`tests/convex/tenantIsolation.test.ts`).
- [x] **E2E for checkout and seller sign-up.** Playwright covers only
      those two flows; they are the ones where a break costs money directly.
- [x] **Contract test for `/api/public/shops/[shopSlug]/catalog.json`.** This is
      the boundary with Octopus Control, which mirrors the feed and now shares
      one validator for it (octopus-control#3). A change to the shape here
      now fails on the producer side too.
- [x] `lib/core/shopStatus.ts` and `lib/notifications/scan.ts` have focused tests.
- [x] `lib/shipping/syncTracking.ts`, `lib/orders/autoConfirm.ts` and `lib/wishlist/*` are covered as part of the
      Convex cutover. Still thin: `lib/payments/payoutValidation.ts`, `lib/products/pricingEnforcement.ts`,
      `lib/products/search.ts`, `lib/shipping/shippingLabelPdf.ts`, `notifications/push.ts`, `notifications/resend.ts`.
- [ ] Route-level tests cover the authorization boundary (`tests/convex/tenantIsolation.test.ts`) but not transition
      legality end to end: whether a shipped order can be moved back to `paid` is asserted only inside Convex, and
      only for the transitions the suite happens to exercise.

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
