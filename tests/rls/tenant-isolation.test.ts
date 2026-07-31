import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, IDS, rlsEnabled, type Db } from '../db/harness';
import { seed } from '../db/seed';

/**
 * Tenant isolation, asked of a real Postgres running the repository's own
 * policies.
 *
 * Two shops, two owners, two unrelated buyers. Every test here is the same
 * question in a different table: can one of them reach the other's rows? The
 * answers matter more than anywhere else in the codebase, because RLS is the
 * last line — every path that reaches the database with a user's token is
 * covered by it, including ones nobody has written yet.
 */

const suite = rlsEnabled ? describe : describe.skip;

let db: Db;

beforeAll(async () => {
    if (!rlsEnabled) return;
    db = await createTestDb(seed);
}, 120_000);

afterAll(async () => {
    await db?.close();
});

const asSellerA = (sql: string, params?: unknown[]) => db.as('authenticated', IDS.sellerA, sql, params);
const asSellerB = (sql: string, params?: unknown[]) => db.as('authenticated', IDS.sellerB, sql, params);
const asBuyer1 = (sql: string, params?: unknown[]) => db.as('authenticated', IDS.buyer1, sql, params);
const asBuyer2 = (sql: string, params?: unknown[]) => db.as('authenticated', IDS.buyer2, sql, params);
const asAnon = (sql: string, params?: unknown[]) => db.as('anon', null, sql, params);

suite('orders', () => {
    it('lets a buyer see their own order', async () => {
        const rows = await asBuyer1(`SELECT public_id FROM orders`);
        expect(rows).toEqual([{ public_id: 'ORD-A' }]);
    });

    it('hides one buyer\'s order from another buyer', async () => {
        const rows = await asBuyer2(`SELECT public_id FROM orders`);
        expect(rows).toEqual([{ public_id: 'ORD-B' }]);
    });

    it('lets a seller see orders placed with their shop', async () => {
        const rows = await asSellerA(`SELECT public_id FROM orders`);
        expect(rows).toEqual([{ public_id: 'ORD-A' }]);
    });

    it('hides one shop\'s orders from the other shop\'s owner', async () => {
        const rows = await asSellerB(`SELECT public_id FROM orders WHERE public_id = 'ORD-A'`);
        expect(rows).toEqual([]);
    });

    it('shows nothing at all to a visitor who is not logged in', async () => {
        expect(await asAnon(`SELECT public_id FROM orders`)).toEqual([]);
    });

    it('refuses an order created in someone else\'s name', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer1,
            `INSERT INTO orders (public_id, buyer_id, shop_id, total_amount)
             VALUES ('ORD-FORGED', $1, $2, 1)`,
            [IDS.buyer2, IDS.shopA],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('does not let a buyer rewrite their own order', async () => {
        // There is no UPDATE policy: status and payment state are the server's
        // to set, through the service role. An UPDATE that matches no policy
        // affects zero rows rather than failing, so the row is re-read.
        await asBuyer1(`UPDATE orders SET total_amount = 0.01 WHERE public_id = 'ORD-A'`);
        const [order] = await db.as('service_role', null, `SELECT total_amount FROM orders WHERE public_id = 'ORD-A'`);
        expect(Number((order as { total_amount: string }).total_amount)).toBe(10);
    });

    it('does not let a buyer delete an order', async () => {
        await asBuyer1(`DELETE FROM orders WHERE public_id = 'ORD-A'`);
        const rows = await db.as('service_role', null, `SELECT public_id FROM orders WHERE public_id = 'ORD-A'`);
        expect(rows).toHaveLength(1);
    });
});

suite('order_items', () => {
    it('follows the order: a buyer sees only their own lines', async () => {
        const rows = await asBuyer1(`SELECT price_at_purchase FROM order_items`);
        expect(rows).toHaveLength(1);
        expect(Number((rows[0] as { price_at_purchase: string }).price_at_purchase)).toBe(10);
    });

    it('does not leak another shop\'s line items to a seller', async () => {
        const rows = await asSellerB(`SELECT id FROM order_items WHERE order_id = $1`, [IDS.orderA]);
        expect(rows).toEqual([]);
    });

    it('refuses a line item attached to someone else\'s order', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer2,
            `INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase)
             VALUES ($1, $2, 1, 0.01)`,
            [IDS.orderA, IDS.variantA],
        );
        expect(message).toMatch(/row-level security/i);
    });
});

suite('refunds', () => {
    it('is visible to the buyer whose order it belongs to', async () => {
        expect(await asBuyer1(`SELECT id FROM refunds`)).toHaveLength(1);
    });

    it('is visible to the seller whose shop processed it', async () => {
        expect(await asSellerA(`SELECT id FROM refunds`)).toHaveLength(1);
    });

    it('is invisible to an unrelated buyer', async () => {
        const rows = await asBuyer2(`SELECT id FROM refunds WHERE order_id = $1`, [IDS.orderA]);
        expect(rows).toEqual([]);
    });

    it('cannot be issued by a seller against another shop\'s order', async () => {
        // Money leaving someone else's Stripe balance: the one that would hurt.
        const message = await db.expectDenied(
            'authenticated',
            IDS.sellerB,
            `INSERT INTO refunds (order_id, amount, processed_by) VALUES ($1, 999, $2)`,
            [IDS.orderA, IDS.sellerB],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('cannot be attributed to someone else even by the right seller', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.sellerA,
            `INSERT INTO refunds (order_id, amount, processed_by) VALUES ($1, 1, $2)`,
            [IDS.orderA, IDS.sellerB],
        );
        expect(message).toMatch(/row-level security/i);
    });
});

suite('order_incidents', () => {
    it('is visible to the buyer and to the shop it concerns', async () => {
        expect(await asBuyer1(`SELECT description FROM order_incidents`)).toEqual([{ description: 'Damaged A' }]);
        expect(await asSellerA(`SELECT description FROM order_incidents`)).toEqual([{ description: 'Damaged A' }]);
    });

    it('is invisible to everyone else', async () => {
        expect(await asBuyer2(`SELECT id FROM order_incidents WHERE order_id = $1`, [IDS.orderA])).toEqual([]);
        expect(await asSellerB(`SELECT id FROM order_incidents WHERE order_id = $1`, [IDS.orderA])).toEqual([]);
        expect(await asAnon(`SELECT id FROM order_incidents`)).toEqual([]);
    });
});

suite('shipments and tracking', () => {
    it('are visible to the buyer and the selling shop', async () => {
        expect(await asBuyer1(`SELECT tracking_number FROM shipments`)).toEqual([{ tracking_number: 'TRACK-A' }]);
        expect(await asSellerA(`SELECT tracking_number FROM shipments`)).toEqual([{ tracking_number: 'TRACK-A' }]);
    });

    it('do not expose a tracking number across tenants', async () => {
        // A tracking number plus a postcode is enough to reroute a parcel with
        // most carriers.
        expect(await asBuyer2(`SELECT id FROM shipments WHERE order_id = $1`, [IDS.orderA])).toEqual([]);
        expect(await asSellerB(`SELECT id FROM shipments WHERE order_id = $1`, [IDS.orderA])).toEqual([]);
        expect(await asAnon(`SELECT id FROM shipments`)).toEqual([]);
    });
});

suite('profiles', () => {
    it('lets a user read their own profile', async () => {
        const rows = await asBuyer1(`SELECT email FROM profiles`);
        expect(rows).toEqual([{ email: 'buyer-1@test.local' }]);
    });

    it('does not expose another user\'s email or address', async () => {
        const rows = await asBuyer1(`SELECT email FROM profiles WHERE id = $1`, [IDS.buyer2]);
        expect(rows).toEqual([]);
    });

    it('shows nothing to an anonymous visitor', async () => {
        expect(await asAnon(`SELECT email FROM profiles`)).toEqual([]);
    });

    it('refuses a write to another user\'s profile', async () => {
        await asBuyer1(`UPDATE profiles SET phone = '666000000' WHERE id = $1`, [IDS.buyer2]);
        const [profile] = await db.as('service_role', null, `SELECT phone FROM profiles WHERE id = $1`, [IDS.buyer2]);
        expect((profile as { phone: string | null }).phone).toBeNull();
    });

    it('refuses a profile inserted under someone else\'s id', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer1,
            `INSERT INTO profiles (id, email) VALUES ($1, 'stolen@test.local')`,
            [IDS.sellerA],
        );
        expect(message).toMatch(/row-level security|duplicate key/i);
    });
});

suite('wishlist', () => {
    it('is private to its owner', async () => {
        expect(await asBuyer1(`SELECT product_id FROM wishlist`)).toEqual([{ product_id: IDS.productB }]);
        expect(await asBuyer2(`SELECT product_id FROM wishlist`)).toEqual([{ product_id: IDS.productA }]);
        expect(await asAnon(`SELECT id FROM wishlist`)).toEqual([]);
    });

    it('cannot be written on someone else\'s behalf', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer1,
            `INSERT INTO wishlist (profile_id, product_id) VALUES ($1, $2)`,
            [IDS.buyer2, IDS.productA],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('cannot be emptied by someone else', async () => {
        await asBuyer1(`DELETE FROM wishlist WHERE profile_id = $1`, [IDS.buyer2]);
        const rows = await db.as('service_role', null, `SELECT id FROM wishlist WHERE profile_id = $1`, [IDS.buyer2]);
        expect(rows).toHaveLength(1);
    });
});

suite('push subscriptions', () => {
    it('are private to their owner', async () => {
        expect(await asBuyer1(`SELECT endpoint FROM push_subscriptions`)).toEqual([
            { endpoint: 'https://push.test/a' },
        ]);
    });

    it('cannot be hijacked to send another user notifications', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer1,
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
             VALUES ($1, 'https://push.test/evil', 'k', 'a')`,
            [IDS.buyer2],
        );
        expect(message).toMatch(/row-level security/i);
    });
});

suite('reviews', () => {
    it('are readable by anyone, including anonymous visitors', async () => {
        expect(await asAnon(`SELECT rating FROM reviews ORDER BY rating`)).toHaveLength(2);
    });

    it('cannot be posted for a product the user never bought', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer2,
            `INSERT INTO reviews (product_id, profile_id, rating) VALUES ($1, $2, 1)`,
            [IDS.productA, IDS.buyer2],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('cannot be posted under another user\'s name', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.buyer2,
            `INSERT INTO reviews (product_id, profile_id, rating) VALUES ($1, $2, 5)`,
            [IDS.productB, IDS.buyer1],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('cannot be edited or deleted by anyone but their author', async () => {
        await asBuyer2(`UPDATE reviews SET comment = 'hacked' WHERE profile_id = $1`, [IDS.buyer1]);
        await asBuyer2(`DELETE FROM reviews WHERE profile_id = $1`, [IDS.buyer1]);

        const rows = await db.as('service_role', null, `SELECT comment FROM reviews WHERE profile_id = $1`, [IDS.buyer1]);
        expect(rows).toEqual([{ comment: 'Great' }]);
    });
});

suite('products and variants', () => {
    it('are public, which is the point of a marketplace', async () => {
        expect(await asAnon(`SELECT title FROM products ORDER BY title`)).toHaveLength(2);
        expect(await asAnon(`SELECT price FROM product_variants`)).toHaveLength(2);
    });

    it('cannot be created in someone else\'s shop', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.sellerB,
            `INSERT INTO products (shop_id, title, category, slug) VALUES ($1,'Injected','cat','injected')`,
            [IDS.shopA],
        );
        expect(message).toMatch(/row-level security/i);
    });

    it('cannot be repriced by another seller', async () => {
        // The attack this blocks: set a rival's variant to 0.01 and buy it.
        await asSellerB(`UPDATE product_variants SET price = 0.01 WHERE id = $1`, [IDS.variantA]);
        const [variant] = await db.as('service_role', null, `SELECT price FROM product_variants WHERE id = $1`, [IDS.variantA]);
        expect(Number((variant as { price: string }).price)).toBe(10);
    });

    it('cannot be deleted by another seller', async () => {
        await asSellerB(`DELETE FROM products WHERE id = $1`, [IDS.productA]);
        const rows = await db.as('service_role', null, `SELECT id FROM products WHERE id = $1`, [IDS.productA]);
        expect(rows).toHaveLength(1);
    });

    it('cannot be renamed by an anonymous visitor', async () => {
        await asAnon(`UPDATE products SET title = 'defaced' WHERE id = $1`, [IDS.productA]);
        const [product] = await db.as('service_role', null, `SELECT title FROM products WHERE id = $1`, [IDS.productA]);
        expect((product as { title: string }).title).toBe('Product A');
    });
});

suite('shops', () => {
    it('are publicly readable, as a storefront must be', async () => {
        expect(await asAnon(`SELECT slug FROM shops ORDER BY slug`)).toHaveLength(2);
    });

    it('cannot be edited by anyone but their owner', async () => {
        await asSellerB(`UPDATE shops SET name = 'Stolen' WHERE id = $1`, [IDS.shopA]);
        const [shop] = await db.as('service_role', null, `SELECT name FROM shops WHERE id = $1`, [IDS.shopA]);
        expect((shop as { name: string }).name).toBe('Shop A');
    });

    it('cannot be registered under another user as owner', async () => {
        const message = await db.expectDenied(
            'authenticated',
            IDS.sellerB,
            `INSERT INTO shops (owner_id, name, slug) VALUES ($1, 'Fake', 'fake')`,
            [IDS.sellerA],
        );
        expect(message).toMatch(/row-level security/i);
    });
});

suite('tables with no policy at all', () => {
    /**
     * RLS enabled with no permissive policy denies everything to `anon` and
     * `authenticated` while leaving `service_role` free. These tables hold
     * carrier credentials, webhook replay state and notification history, so
     * deny-all is the intended configuration — pinned here because adding a
     * well-meaning policy later would open them.
     */
    for (const table of ['sendcloud_config', 'processed_webhook_events', 'notification_log']) {
        it(`${table} is unreachable from the browser`, async () => {
            // Reached for by two locks: the grant is revoked *and* RLS has no
            // permissive policy. Either alone would be enough; asserting the
            // outcome rather than the mechanism means tightening or loosening
            // one of them does not produce a spurious failure here.
            for (const [who, id] of [
                ['anon', null],
                ['buyer', IDS.buyer1],
                ['seller', IDS.sellerA],
            ] as const) {
                const role = who === 'anon' ? 'anon' : 'authenticated';
                const denied = await db
                    .as(role, id, `SELECT * FROM ${table}`)
                    .then((rows) => rows.length === 0, () => true);
                expect(denied, `${who} reached ${table}`).toBe(true);
            }
        });
    }
});

suite('RLS is enabled everywhere', () => {
    it('leaves no public table unprotected', async () => {
        // A new table without `ENABLE ROW LEVEL SECURITY` is readable and
        // writable by anyone holding the publishable key. This catches that at
        // the moment the table is added, not after.
        const rows = (await db.as(
            'service_role',
            null,
            `SELECT c.relname AS table_name
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
              ORDER BY 1`,
        )) as Array<{ table_name: string }>;

        expect(rows.map((r) => r.table_name)).toEqual([]);
    });
});
