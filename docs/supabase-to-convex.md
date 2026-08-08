# Supabase → Convex migration

This migration is intentionally staged. Supabase remains the write authority
until the Convex cloud deployment, Clerk identity mapping, and route-by-route
verification are complete.

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
- Clerk development is connected to Convex with the `convex` JWT template and
  issuer configuration. The Astro middleware verifies Clerk sessions with
  `@clerk/backend` (Cloudflare-safe), links profiles by verified email, and
  stores the Clerk subject in Convex. Profile updates and wishlist operations
  use Convex for Clerk sessions while mirroring the legacy Supabase rows during
  the soak period.
- Authenticated buyer profile/order overview, buyer order history, and seller
  order history now read through authorized Convex queries for Clerk sessions;
  legacy sessions and query failures retain the Supabase fallback.
- Buyer review submission now calls an authorized Convex mutation first. It
  verifies a confirmed purchase and preserves the Supabase implementation as a
  rollback fallback during the soak period.
- The test Worker has been deployed and smoke-tested at
  `https://fewya-test.olma.workers.dev`; production secrets are prepared but
  production traffic has not been switched.

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
4. Move the remaining authenticated writes, seller dashboard reads, and background
   jobs to Convex functions with server-side authorization. Do not expose the
   migration functions after the import.
5. Keep Supabase as a read-only rollback source during a soak period. Only
   then remove the Supabase secrets and delete the temporary migration module.

The migration module is deliberately not safe to leave public without a
deployment secret. It must be made internal or removed before production
cutover.
