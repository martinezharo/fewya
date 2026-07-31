# RLS tests

These run the repository's own `db-structure/*.sql` against a real PostgreSQL
and then ask it the only question that matters about a policy: **can the wrong
person reach this row?**

They are separate from `bun run test` on purpose. The unit suite must stay
runnable with nothing installed — the pre-push hook runs it — while these need
a database. Without `RLS_DATABASE_URL` set they skip rather than fail.

## Running them

```bash
export RLS_DATABASE_URL='postgresql://postgres@localhost:5432/postgres'
bun run test:rls
```

The URL must point at a **superuser** on a throwaway cluster: the harness
creates a fresh database per run (`fewya_rls_<timestamp>`) and creates the
`anon` / `authenticated` / `service_role` roles if they are missing.

### With the Supabase CLI

```bash
bunx supabase start
export RLS_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
bun run test:rls
```

### With a plain PostgreSQL 16

Any local cluster works — nothing here needs Supabase itself. `tests/db/bootstrap.sql`
recreates the only pieces the schema references: the three PostgREST roles,
`auth.uid()`, `auth.users`, and the `storage` tables the bucket policies are
written against.

## How a test says "this request comes from that user"

Exactly the way PostgREST does it. `auth.uid()` reads the
`request.jwt.claim.sub` setting, so the harness sets the role and that claim
inside a transaction:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user uuid>', true);
-- ... the query under test ...
COMMIT;
```

Each call is its own transaction, so no test can leak its identity into the
next one.

## What the fixture contains

Two shops with different owners, two unrelated buyers, and one paid order per
shop, plus the shipment, refund, incident, review and wishlist rows that hang
off them. That is the smallest world in which "seller B must not see this" is a
real question rather than an empty set.

Rows are written as `service_role`, the way the server writes them, and read
back as the people who must and must not be able to.

## Adding a table

`RLS is enabled everywhere > leaves no public table unprotected` fails the
moment a table is added to `public` without `ENABLE ROW LEVEL SECURITY`. A new
table with policies should also get its own isolation test here — the generic
check only proves RLS is on, not that the policy is right.
