import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Runs the repository's own `db-structure/*.sql` against a real Postgres and
 * exposes it the way PostgREST does: as `anon`, as `authenticated` with a
 * specific `auth.uid()`, or as `service_role`.
 *
 * Policies cannot be unit tested. `USING (auth.uid() = buyer_id)` is a sentence
 * about rows, and the only thing that can tell you whether it keeps one
 * seller's orders away from another is Postgres evaluating it. So these tests
 * load the real files — not a paraphrase — and ask the database.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const STRUCTURE_DIR = path.join(ROOT, 'db-structure');
const BOOTSTRAP = path.join(import.meta.dirname, 'bootstrap.sql');

/** Set to a superuser connection string to enable the suite; see tests/rls/README.md. */
export const DATABASE_URL = process.env.RLS_DATABASE_URL ?? '';

export const rlsEnabled = DATABASE_URL !== '';

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface Db {
    /** Runs `sql` as `role`, impersonating `userId` when authenticated. */
    as(role: Role, userId: string | null, sql: string, params?: unknown[]): Promise<unknown[]>;
    /** Same, but returns the error message instead of throwing. */
    expectDenied(role: Role, userId: string | null, sql: string, params?: unknown[]): Promise<string>;
    close(): Promise<void>;
}

async function applyFile(client: Client, file: string): Promise<void> {
    await client.query(await readFile(file, 'utf8'));
}

/**
 * Builds a fresh database with the real schema loaded, then seeds it.
 *
 * A new database per run rather than a shared one: RLS tests read across
 * tenants by design, so leftover rows from an earlier run would quietly change
 * what "seller B sees nothing" means.
 */
export async function createTestDb(seed: (db: Db) => Promise<void>): Promise<Db> {
    const dbName = `fewya_rls_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const url = new URL(DATABASE_URL);
    url.pathname = `/${dbName}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();

    await applyFile(client, BOOTSTRAP);
    const files = (await readdir(STRUCTURE_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
        await applyFile(client, path.join(STRUCTURE_DIR, file));
    }

    const db: Db = {
        async as(role, userId, sql, params = []) {
            // Wrapped in a transaction so `SET LOCAL` unwinds afterwards and no
            // test can leak its identity into the next one.
            await client.query('BEGIN');
            try {
                await client.query(`SET LOCAL ROLE ${role}`);
                await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
                await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role]);
                const result = await client.query(sql, params);
                await client.query('COMMIT');
                return result.rows;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        },

        async expectDenied(role, userId, sql, params = []) {
            try {
                await db.as(role, userId, sql, params);
            } catch (error) {
                return (error as Error).message;
            }
            throw new Error(`Expected the database to refuse this, but it succeeded:\n  ${sql}`);
        },

        async close() {
            await client.end();
        },
    };

    await seed(db);
    return db;
}

/** Deterministic ids, so a failure message points at a recognisable actor. */
export const IDS = {
    sellerA: '00000000-0000-4000-8000-00000000000a',
    sellerB: '00000000-0000-4000-8000-00000000000b',
    buyer1: '00000000-0000-4000-8000-000000000001',
    buyer2: '00000000-0000-4000-8000-000000000002',
    shopA: '00000000-0000-4000-8000-0000000000aa',
    shopB: '00000000-0000-4000-8000-0000000000bb',
    productA: '00000000-0000-4000-8000-0000000000a1',
    productB: '00000000-0000-4000-8000-0000000000b1',
    variantA: '00000000-0000-4000-8000-0000000000a2',
    variantB: '00000000-0000-4000-8000-0000000000b2',
    orderA: '00000000-0000-4000-8000-0000000000a3',
    orderB: '00000000-0000-4000-8000-0000000000b3',
} as const;
