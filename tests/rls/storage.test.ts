import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, IDS, rlsEnabled, type Db } from '../db/harness';
import { seed } from '../db/seed';

const suite = rlsEnabled ? describe : describe.skip;
let db: Db;

beforeAll(async () => {
    if (!rlsEnabled) return;
    db = await createTestDb(seed);
    await db.as('service_role', null, `
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('imgs', 'products/${IDS.shopA}/a.webp'),
          ('imgs', 'products/${IDS.shopB}/b.webp'),
          ('imgs', 'profiles/${IDS.sellerA}/a.webp'),
          ('imgs', 'profiles/${IDS.sellerB}/b.webp'),
          ('imgs', 'banners/${IDS.sellerA}/a.webp'),
          ('imgs', 'banners/${IDS.sellerB}/b.webp'),
          ('imgs', 'avatars/${IDS.buyer1}/a.webp'),
          ('imgs', 'avatars/${IDS.buyer2}/b.webp'),
          ('labels', 'products/${IDS.shopA}/private.pdf')
    `);
}, 120_000);

afterAll(async () => db?.close());

suite('storage RLS', () => {
    it.each(['products', 'profiles', 'banners', 'avatars'])(
        'allows public reads in the imgs/%s folder only',
        async (folder) => {
            const rows = await db.as('anon', null, `SELECT name FROM storage.objects WHERE name LIKE $1 ORDER BY name`, [`${folder}/%`]);
            expect(rows).toHaveLength(2);
        },
    );

    it('never exposes private labels or unrelated img folders', async () => {
        expect(await db.as('anon', null, `SELECT name FROM storage.objects WHERE bucket_id = 'labels'`)).toEqual([]);
        await db.as('service_role', null, `INSERT INTO storage.objects (bucket_id, name) VALUES ('imgs', 'private/file.webp')`);
        expect(await db.as('anon', null, `SELECT name FROM storage.objects WHERE name = 'private/file.webp'`)).toEqual([]);
    });

    it('lets a shop owner insert, update and delete their product images only', async () => {
        await db.as('authenticated', IDS.sellerA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('imgs', $1)`, [`products/${IDS.shopA}/new.webp`]);
        await expect(db.expectDenied('authenticated', IDS.sellerA, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [`products/${IDS.shopB}/moved.webp`, `products/${IDS.shopA}/new.webp`])).resolves.toMatch(/row-level security/i);
        await db.as('authenticated', IDS.sellerA, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [`products/${IDS.shopA}/renamed.webp`, `products/${IDS.shopA}/new.webp`]);
        await db.as('authenticated', IDS.sellerA, `DELETE FROM storage.objects WHERE name = $1`, [`products/${IDS.shopA}/renamed.webp`]);

        await expect(db.expectDenied('authenticated', IDS.sellerA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('imgs', $1)`, [`products/${IDS.shopB}/stolen.webp`])).resolves.toMatch(/row-level security/i);
        await db.as('authenticated', IDS.sellerA, `UPDATE storage.objects SET name = 'products/${IDS.shopA}/stolen.webp' WHERE name = $1`, [`products/${IDS.shopB}/b.webp`]);
        await db.as('authenticated', IDS.sellerA, `DELETE FROM storage.objects WHERE name = $1`, [`products/${IDS.shopB}/b.webp`]);
        expect(await db.as('service_role', null, `SELECT name FROM storage.objects WHERE name = $1`, [`products/${IDS.shopB}/b.webp`])).toHaveLength(1);
    });

    it.each([
        ['profiles', IDS.sellerA, IDS.sellerB],
        ['banners', IDS.sellerA, IDS.sellerB],
        ['avatars', IDS.buyer1, IDS.buyer2],
    ])('enforces owner-scoped writes for %s', async (folder, owner, other) => {
        const original = `${folder}/${owner}/write.webp`;
        const renamed = `${folder}/${owner}/renamed.webp`;
        await db.as('authenticated', owner, `INSERT INTO storage.objects (bucket_id, name) VALUES ('imgs', $1)`, [original]);
        await expect(db.expectDenied('authenticated', owner, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [`${folder}/${other}/moved.webp`, original])).resolves.toMatch(/row-level security/i);
        await db.as('authenticated', owner, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [renamed, original]);
        await db.as('authenticated', owner, `DELETE FROM storage.objects WHERE name = $1`, [renamed]);

        await expect(db.expectDenied('authenticated', owner, `INSERT INTO storage.objects (bucket_id, name) VALUES ('imgs', $1)`, [`${folder}/${other}/stolen.webp`])).resolves.toMatch(/row-level security/i);
        await db.as('authenticated', owner, `DELETE FROM storage.objects WHERE name = $1`, [`${folder}/${other}/b.webp`]);
        expect(await db.as('service_role', null, `SELECT name FROM storage.objects WHERE name = $1`, [`${folder}/${other}/b.webp`])).toHaveLength(1);
    });
});
