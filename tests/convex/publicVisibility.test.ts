/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { api } from '../../convex/_generated/api';
import { newTestHarness, seedTenant, type Harness, type SeededTenant } from './fixtures';

/**
 * Everything the anonymous storefront can see comes from these queries, so
 * they are the only thing standing between a half-onboarded shop and the
 * public catalog.
 */

let t: Harness;
let shop: SeededTenant;

async function patchShop(patch: Record<string, unknown>) {
    await t.run(async (ctx) => {
        await ctx.db.patch(shop.shopId, patch as never);
    });
}

beforeEach(async () => {
    t = newTestHarness();
    shop = await seedTenant(t, 'a', 'clerk|seller-a');
});

describe('public catalog visibility', () => {
    it('lists a shop that is active, paid up and complete', async () => {
        const shops = await t.query(api.catalog.listPublicShops, { limit: 12 });
        expect(shops.map((entry: any) => entry.slug)).toEqual(['shop-a']);
        expect(await t.query(api.catalog.getShopCatalog, { slug: 'shop-a' })).not.toBeNull();
    });

    for (const [label, patch] of [
        ['the shop is deactivated', { isActive: false }],
        ['the shop is not active', { status: 'inactive' }],
        ['payments are not enabled', { paymentsActive: false }],
        ['seller details are incomplete', { sellerDetailsComplete: false }],
    ] as const) {
        it(`hides the shop when ${label}`, async () => {
            await patchShop(patch);
            expect(await t.query(api.catalog.listPublicShops, { limit: 12 })).toEqual([]);
            expect(await t.query(api.catalog.getShopCatalog, { slug: 'shop-a' })).toBeNull();
        });
    }

    it('hides a deactivated product from the shop catalog', async () => {
        await t.run(async (ctx) => {
            await ctx.db.patch(shop.productId, { isActive: false });
        });
        const catalog = await t.query(api.catalog.getShopCatalog, { slug: 'shop-a' });
        expect(catalog?.products ?? []).toEqual([]);
    });

    it('does not expose a product whose shop cannot sell', async () => {
        await patchShop({ paymentsActive: false });
        expect(await t.query(api.catalog.getProduct, {
            shopSlug: 'shop-a',
            productSlug: 'product-a',
        })).toBeNull();
    });

    it('keeps unsellable shops out of the sitemap', async () => {
        await patchShop({ sellerDetailsComplete: false });
        const entries = await t.query(api.catalog.sitemapEntries, {});
        expect(entries.shops).toEqual([]);
        expect(entries.products).toEqual([]);
    });
});
