# Supabase → Convex migration

Convex is the only database the application code knows about. Supabase is gone
from the repository: there is no client, no compatibility path and no fallback.
Production traffic on `fewya.com` was switched to Convex and Clerk production
on 2026-09-10. The cutover status and reproducible procedure are recorded below.

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
- Provider checks on 2026-09-10 found 8 complete/paid Stripe sessions,
  7 expired/unpaid sessions, and **1 open/unpaid session**. Sendcloud reports
  all 7 shipments delivered. The open session is a test checkout created by the
  owner; a payment arriving on it is refunded and reported rather than
  acknowledged, because an imported order cannot be fulfilled from here.

Imported orders keep their Supabase UUID as `legacyId`, and that prefix decides
one thing only: whether Convex may move their money or stock. It never decides
who may read them. Their buyers and sellers keep every other operation —
reading the order, opening its label, tracking its shipment, hiding an
abandoned checkout — authorized on ownership like any other order.

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

Production cutover performed on 2026-09-10:

- Clerk production instance `ins_3J9626kyJEa8blSGsd2xfiA7Glf` is configured
  for `fewya.com`. Clerk reports DNS, SSL, email DNS and Google OAuth complete.
  The `convex` JWT template emits `"email_verified": "{{user.email_verified}}"`.
- Production Convex trusts `https://clerk.fewya.com`; its functions and auth
  configuration were deployed after setting the issuer.
- Final snapshot `.migrations/supabase-export/2026-09-10T17-34-03-395Z`
  matches the previous exported table contents, so no delta import was needed.
- Worker build `7488c4e2-a46d-4668-8893-cfd82deb7b1b` was deployed to
  `fewya` with production Clerk keys and `CONVEX_WEBHOOK_SECRET`. A subsequent
  secret-only version removes `SUPABASE_SECRET_KEY` from both `fewya` and
  `fewya-test`.
- All 631 tests passed before cutover; the 38 middleware tests and production
  build passed after fixing CSP to allow `https://clerk.fewya.com`.
  Browser checks confirm the public catalog and the Clerk sign-in form load
  without JavaScript errors. The sign-in form displays Continue with Google.
- Signed synthetic Stripe and Sendcloud probes using nonexistent payment and
  shipment references returned HTTP 200, exercising Worker-to-Convex auth
  without modifying orders. Unsigned probes were rejected. Stripe's live
  endpoint is enabled at `https://fewya.com/api/webhooks/stripe`.
- Google redirect rechecked successfully: the button reaches Google's sign-in
  page for `fewya.com`, without `redirect_uri_mismatch`.
- A successful user sign-in/account-linking check and actual provider-originated
  webhook deliveries remain pending. Synthetic probes are not evidence
  of a provider delivery. Keep Supabase available and retain the snapshots
  until these final checks are satisfactory.

Production keys are saved in ignored, mode-0600 `.env.clerk-production`.
That file also contains DNS and Google credentials: do not bulk-upload it to
Workers. Only Clerk keys belong in Worker bindings. Use the existing Wrangler
OAuth login for deployments; the DNS-only token cannot deploy Workers.
The five production DNS records are in [the zone file](clerk-production-dns.txt).
Google's existing web client uses `https://clerk.fewya.com/v1/oauth_callback`;
retain the Supabase callback until the old stack is retired.

Merging this branch does not move production traffic: there is no deploy
pipeline, and the live Worker keeps running its current build until someone
deploys. The following procedure documents how to reproduce the switch:

1. **Create a Clerk production instance** for `fewya.com` and add its DNS
   records. Then:
   - `bunx convex env set CLERK_JWT_ISSUER_DOMAIN <production issuer> --prod`
   - `bunx wrangler secret put PUBLIC_CLERK_PUBLISHABLE_KEY --name fewya`
   - `bunx wrangler secret put CLERK_SECRET_KEY --name fewya`

   Run `bunx convex deploy` after changing the issuer to synchronize the auth
   configuration. Production must trust the production Clerk issuer.
2. **Give the Worker the deployment secret** so webhooks and cron can write:
   `bunx wrangler secret put CONVEX_WEBHOOK_SECRET --name fewya` — the same
   value as `bunx convex env list --prod`.
3. **Re-import** if the switch happens long after 2026-09-10, so no orders
   placed in the meantime are lost:
   `bunx convex env set MIGRATION_SECRET <random> --prod`, then
   `bun run migration:export && CONVEX_URL=<prod url> MIGRATION_SECRET=<same> bun run migration:import`,
   then `bunx convex env remove MIGRATION_SECRET --prod`.
4. **Deploy** the Worker:
   `env -u CLOUDFLARE_ENV bun --env-file=.env.clerk-production run build && bunx wrangler deploy`.
   The production publishable key must be present during the build because
   the Clerk integration and middleware read it through `import.meta.env`.
   Worker secrets alone do not replace a development key embedded in a build.
   Production uses the root Wrangler configuration; there is no named
   `production` environment. Setting `CLOUDFLARE_ENV=production` fails during
   type generation. Check that `dist/server/wrangler.json` names `fewya` and
   points at `quirky-puffin-695` before deploying.
   The Cloudflare Workers Build that runs on a push to `main` does **not**
   have this key: it builds from a clean checkout with no `.env`. On
   2026-09-10 such a build deployed itself over the working Worker and took
   `fewya.com` down — Clerk's middleware throws before anything else runs, so
   every request, catalog included, answered a redirect to itself. The build
   now refuses to produce that bundle (`astro.config.mjs`), so CI fails
   instead of deploying. To let CI deploy again, add
   `PUBLIC_CLERK_PUBLISHABLE_KEY` under *Settings → Builds → Variables and
   Secrets* on the `fewya` Worker. It is a publishable key, served to every
   visitor in the page bundle, so it belongs in a build variable rather than
   a secret.
5. **Point Stripe and Sendcloud webhooks** at the deployed Worker (the URLs do
   not change) and confirm one event of each arrives.
6. **Remove the leftovers**: `bunx wrangler secret delete SUPABASE_SECRET_KEY --name fewya`
   (and the same on `fewya-test`), then pause or delete the Supabase project
   once you are satisfied — keep the exported snapshot under `.migrations/`
   until then.

## Merge readiness audit (2026-09-10)

Four regressions were found auditing the deployed migration against production
data. All four are fixed, and `tests/convex/readiness.audit.test.ts` keeps
them fixed:

1. **`users.updateCurrent` could not clear a field.** It accepted `null` while
   the stored columns are optional strings, so emptying an address line — the
   profile form posts every field it owns — failed the schema and returned a
   503. `null` and a blank submission now both clear the field, which Convex
   spells `undefined`.
2. **`orders.confirmDeliveryForBuyer` marked the funds released before the
   transfer.** Called directly with a Clerk token it left the order confirmed,
   `fundsReleasedAt` set and `fundsReleaseStatus` at `pending` — outside the
   delivered-order scan and outside the failed-release retry, with the seller
   never paid. Confirming now only records a *request* for the payout
   (`fundsReleaseRequestedAt`); `recordFundsRelease`, which needs the
   deployment secret, is the one place that writes `fundsReleasedAt`, and the
   retry scan sweeps anything requested and not released.
3. **`storage.getUrl` handed a private file to any signed-in caller.** A
   session is not permission: shipping labels carry the buyer's name and
   address. Resolution is now authorized against the documents that tie the
   object to the caller — the upload it claimed, its own avatar, its shop's
   images, or an order it is party to. `resolveLegacyUrl` is gone; a label is
   resolved inside `orders.getShipmentForAccess`, behind the buyer/seller check
   that endpoint already runs.
4. **The `convex:` prefix was being used as an access rule.** It blocked
   imported orders from operations their owners are entitled to, such as hiding
   an abandoned checkout or opening a delivered order's label. The prefix now
   guards only what it was meant to guard — paying, refunding, restocking and
   paying out — and everything else authorizes on ownership like any other
   order.

The open Stripe session against an imported order (a test checkout created by
the owner) no longer resolves into a silent acknowledgement: a payment matching
only imported orders is refunded and reported, instead of being kept with
nothing to ship.

The production Convex export was compared with the final Supabase snapshot:
all 3,512 transformed source fields match, all checked relationships resolve,
and all 88 stored files match their original SHA-256 hashes. Order and refund
amounts remain 6,672 and 350 cents respectively. Data preservation does not
establish equivalent behavior or authorization, which is what the audit suite
is for.

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
