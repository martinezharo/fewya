# Supabase → Convex migration

This migration is intentionally staged. The isolated test Worker is Convex-only;
production remains on the compatibility path until the production soak and
cutover are explicitly approved.

## Current state

- `bun run migration:export` creates an ignored, timestamped snapshot of all
  application tables, Supabase Auth users, and both Storage buckets.
- `bun run migration:import` loads the latest snapshot into the selected Convex
  deployment. It is idempotent for rows and Storage objects.
- `convex/schema.ts` contains the application model and preserves every source
  UUID as `legacyId` during the transition.
- Public catalog reads use Convex when `CONVEX_URL` is configured and fall back
  to Supabase while staging is being rolled out.
- Convex cloud dev deployment is provisioned at
  `https://tremendous-fennec-292.convex.cloud` and contains the imported
  snapshot (15 profiles, 3 shops, 12 products, 14 variants, 9 orders, 194
  tracking events, 82 processed webhook events, and 87 Storage objects).
- The test Worker (`fewya-test`) points at that Convex dev deployment with
  `CONVEX_ONLY=true`. It does not initialise a Supabase admin client, does not
  issue Supabase queries, and has no cron triggers. It is not a separate
  Supabase development database, and the production Supabase project is not
  written by the test Worker.
- Clerk development is connected to Convex with the `convex` JWT template and
  issuer configuration. The Astro middleware verifies Clerk sessions with
  `@clerk/backend` (Cloudflare-safe), links profiles by verified email, and
  stores the Clerk subject in Convex. Profile updates, wishlist operations,
  catalog management, seller settings, and uploads use Convex in the isolated
  Worker; the Supabase compatibility implementation remains available only to
  the staged production build.
- Authenticated buyer profile/order overview, buyer order history, and seller
  order history now read through authorized Convex queries for Clerk sessions;
  in the isolated Worker a Convex error is surfaced without falling back to
  Supabase. Legacy sessions keep the guarded rollback path in production.
- Buyer and seller review operations now use authorized Convex mutations in the
  isolated Worker. The Supabase implementation remains available only as a
  rollback path during the production soak period.
- The test Worker has been deployed and smoke-tested at
  `https://fewya-test.olma.workers.dev`; production secrets are prepared but
  production traffic has not been switched.
- Checkout, Stripe payment processing, order lifecycle, Sendcloud
  shipment/tracking, payouts, notifications, reviews, and scheduled-job helpers
  use Convex in the isolated Worker. The production build still contains the
  guarded Supabase rollback path until cutover.

## Local smoke test

```bash
bunx convex dev
# in a second terminal
bun run migration:import
bun run check
```

The local snapshot currently contains 15 profiles, 3 shops, 12 products, 14
variants, 9 orders, 194 tracking events, 82 processed webhook events, and 87
Storage objects. These counts are checksums for the migration rehearsal, not a
production cutover instruction.

## Cloud staging gates

1. Authenticate the Convex CLI (`bunx convex login`) and create a dedicated
   staging deployment.
2. Set a random `MIGRATION_SECRET` in that deployment, run the import, and
   verify row counts, relationships, money totals, and Storage checksums.
3. ~~Configure Clerk and its Convex JWT template.~~ Done in the dev deployment.
   On first Clerk login, the middleware links the existing profile by verified
   email and persists the Clerk subject in `profiles.authSubject`.
4. Complete the authenticated staging soak against the test Worker, including
   Clerk login, buyer checkout/review, seller catalog/shipping flows, Stripe
   test webhooks, and manual cron endpoints. Do not expose the migration
   functions after the import.
5. Create a separate Convex production deployment and import a fresh snapshot;
   never repoint the test deployment at production data.
6. Keep Supabase as a read-only rollback source during a production soak. Only
   after explicit approval should the production Worker switch to
   `CONVEX_ONLY=true`, production secrets be rotated, and the compatibility
   code be removed.

The migration module is deliberately not safe to leave public without a
deployment secret. It must be made internal or removed before production
cutover.
