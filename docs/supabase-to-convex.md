# Supabase → Convex migration

Convex is the only database the application code knows about. Supabase is gone
from the repository: there is no client, no compatibility path and no fallback.
What remains is a deployment decision — pointing `fewya.com` at the new stack —
and that is deliberately a manual step, described under **Cutover** below.

## Where the data lives

| | Deployment | Contents |
| --- | --- | --- |
| Production | `quirky-puffin-695` (`https://quirky-puffin-695.convex.cloud`) | Full snapshot of the Supabase project, imported 2026-09-10 |
| Staging | `tremendous-fennec-292` | Same snapshot; used by the `fewya-test` Worker |

The imported snapshot, verified against Supabase on the same day:

| Table | Rows | | Table | Rows |
| --- | --- | --- | --- | --- |
| profiles | 21 | | shipments | 7 |
| shops | 3 | | shipmentTracking | 219 |
| shopPaymentAccounts | 2 | | reviews | 2 |
| products | 12 | | wishlist | 2 |
| productVariants | 14 | | pushSubscriptions | 8 |
| orders | 16 | | notificationLog | 13 |
| orderItems | 16 | | processedWebhookEvents | 94 |
| refunds | 1 | | storageObjects | 88 |

Checks that were run against the exported production snapshot:

- Every relationship resolved: 16/16 orders have a buyer and a shop, 16/16
  order items have an order and a variant, 14/14 variants have a product,
  12/12 products have a shop, 3/3 shops have an owner, 219/219 tracking events
  have a shipment, 88/88 storage objects have an uploaded file.
- Money matches to the cent: orders total 6672 cents and refunds 350 cents in
  both Supabase and Convex.
- Every order in the snapshot is in a terminal state (7 confirmed and paid out,
  1 cancelled, 8 abandoned before payment). No in-flight order is stranded by
  the cutover, which matters because Convex mutations deliberately refuse to
  act on imported orders — only orders created after the cutover, whose
  `legacyId` starts with `convex:`, can be paid, shipped or refunded.

## How authorization works now

Row-level security policies are gone with Postgres. Every rule now lives in the
Convex function that reads or writes the document, and the Worker never holds a
privileged database client: each route acts as the caller through
`createRequestConvexClient(request)`.

Three kinds of caller exist:

1. **A person.** The middleware verifies the Clerk session, exchanges it for a
   Convex JWT, and publishes both on the request. Convex resolves the identity
   itself, so a route cannot act on behalf of someone else.
2. **The Worker's own jobs** — the Stripe and Sendcloud webhooks, and the cron.
   They have no session, so they authenticate with `CONVEX_WEBHOOK_SECRET`,
   which is set in the Convex deployment's environment.
3. **Nobody.** Public catalog reads take no identity at all and only ever
   return shops that are active, paid up and complete.

`tests/convex/` runs the real functions against an in-memory deployment and
asserts the boundary directly: a second buyer, a second seller and a second
shop exist in every fixture, and every test asks whether the wrong one can get
through. That suite replaces the Postgres RLS tests.

> **The Clerk `convex` JWT template MUST emit the `email_verified` claim.**
> Linking an existing profile by email hands over its orders, address and
> seller permissions, so `users.ensureCurrent` only adopts a profile when the
> claim is `true`; a missing claim counts as unverified. Without it, returning
> users cannot link and the mutation refuses the sign-in rather than forking
> the account into a second profile.

## Cutover

Merging this branch does not move production traffic: there is no deploy
pipeline, and the live Worker keeps running its current build until someone
deploys. To complete the switch:

1. **Create a Clerk production instance** for `fewya.com` and add its DNS
   records. Then:
   - `bunx convex env set CLERK_JWT_ISSUER_DOMAIN <production issuer> --prod`
   - `bunx wrangler secret put PUBLIC_CLERK_PUBLISHABLE_KEY --name fewya`
   - `bunx wrangler secret put CLERK_SECRET_KEY --name fewya`

   Until this is done the production Convex deployment trusts the Clerk
   *development* instance, which is fine for staging and not for real traffic.
2. **Give the Worker the deployment secret** so webhooks and cron can write:
   `bunx wrangler secret put CONVEX_WEBHOOK_SECRET --name fewya` — the same
   value as `bunx convex env list --prod`.
3. **Re-import** if the switch happens long after 2026-09-10, so no orders
   placed in the meantime are lost:
   `bunx convex env set MIGRATION_SECRET <random> --prod`, then
   `bun run migration:export && CONVEX_URL=<prod url> MIGRATION_SECRET=<same> bun run migration:import`,
   then `bunx convex env remove MIGRATION_SECRET --prod`.
4. **Deploy** the Worker: `CLOUDFLARE_ENV=production bun run build && bunx wrangler deploy`.
5. **Point Stripe and Sendcloud webhooks** at the deployed Worker (the URLs do
   not change) and confirm one event of each arrives.
6. **Remove the leftovers**: `bunx wrangler secret delete SUPABASE_SECRET_KEY --name fewya`
   (and the same on `fewya-test`), then pause or delete the Supabase project
   once you are satisfied — keep the exported snapshot under `.migrations/`
   until then.

## The migration tooling

`bun run migration:export` writes a timestamped snapshot of every Supabase
table, its Auth users and both Storage buckets to `.migrations/`, which is
git-ignored because it contains personal data. `bun run migration:import`
loads the newest snapshot into the Convex deployment named by `CONVEX_URL`. It
is idempotent for rows and for Storage objects, so it can be re-run to catch up
before the final switch.

`convex/migration.ts` is the endpoint that import writes through. It refuses
every call unless `MIGRATION_SECRET` is set in the deployment environment and
matches — and it is **not** set on either deployment right now, which is what
keeps it closed. Set it only for the duration of an import.
