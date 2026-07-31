-- ============================================================
-- Supabase stand-ins, so db-structure/*.sql loads unmodified.
--
-- These recreate only what the schema and its policies actually reference:
-- the three PostgREST roles, `auth.uid()`, `auth.users`, and the parts of
-- `storage` the bucket policies are written against. Everything else about a
-- real Supabase project is irrelevant to whether a policy lets the wrong
-- person read a row.
--
-- The point of loading the real db-structure files on top of this is that the
-- policies under test are the ones in the repo, not a paraphrase of them.
-- ============================================================

-- PostgREST connects as one of these. `anon` is an unauthenticated visitor,
-- `authenticated` is a logged-in user, and `service_role` is the server-side
-- key that bypasses RLS.
--
-- Roles live in the cluster, not in the database, so they survive a dropped
-- test database and have to be created conditionally.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS auth;

-- Only the columns the schema's own `on_auth_user_created` trigger reads. That
-- trigger is left in place rather than stubbed, so the seed creates profiles
-- the same way a real sign-up does.
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

/**
 * Supabase derives this from the request's JWT. PostgREST exposes the claims
 * as a GUC, so setting `request.jwt.claim.sub` is exactly how a test says
 * "this request arrives as that user" — the same mechanism the real thing uses.
 */
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text;
$$;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

/** Splits an object key into path segments, as the storage policies expect. */
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/');
$$;

-- PostgREST grants usage on the API schemas to its roles; without this the
-- tests would fail on privileges rather than on the policies being tested.
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage
  TO anon, authenticated, service_role;

-- Only the server ever writes to auth.users; the seed does it through
-- service_role, the same way Supabase Auth would.
GRANT SELECT, INSERT ON auth.users TO service_role;
