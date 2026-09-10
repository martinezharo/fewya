/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { api } from '../../convex/_generated/api';
import {
    newTestHarness,
    identity,
    seedBuyer,
    seedOrder,
    seedTenant,
    type Harness,
    type SeededTenant,
} from './fixtures';

/**
 * These replace the Postgres RLS suite. The question is the same one those
 * asked — can the wrong person reach this row? — but the answer now lives in
 * the Convex functions, so this runs them for real against an in-memory
 * deployment instead of paraphrasing their rules.
 */

const SELLER_A = 'clerk|seller-a';
const SELLER_B = 'clerk|seller-b';
const BUYER_A = 'clerk|buyer-a';
const BUYER_B = 'clerk|buyer-b';

let t: Harness;
let shopA: SeededTenant;
let shopB: SeededTenant;
let buyerA: { profileId: any; profileLegacyId: string };
let buyerB: { profileId: any; profileLegacyId: string };
let orderA: { orderLegacyId: string };

beforeEach(async () => {
    t = newTestHarness();
    shopA = await seedTenant(t, 'a', SELLER_A);
    shopB = await seedTenant(t, 'b', SELLER_B);
    buyerA = await seedBuyer(t, 'buyer-a', BUYER_A);
    buyerB = await seedBuyer(t, 'buyer-b', BUYER_B);
    // A delivered order: buyer A bought from shop A.
    orderA = await seedOrder(t, 'ORD-A', buyerA, shopA);
});

describe('order access', () => {
    it('lets the buyer read their own order payout context', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        const payout = await asBuyerA.query(api.orders.getPayoutContextForCurrentUser, {
            orderId: orderA.orderLegacyId,
        });
        expect(payout.publicId).toBe('ORD-A');
    });

    it('lets the seller of the order shop read it', async () => {
        const asSellerA = t.withIdentity(identity(SELLER_A, 'a@fewya.test'));
        const payout = await asSellerA.query(api.orders.getPayoutContextForCurrentUser, {
            orderId: orderA.orderLegacyId,
        });
        expect(payout.publicId).toBe('ORD-A');
        // Seller-only actions (retrying a payout) key off this flag.
        expect(payout.viewerIsSeller).toBe(true);
    });

    it('marks the buyer as not the seller, so seller-only actions can refuse', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        const payout = await asBuyerA.query(api.orders.getPayoutContextForCurrentUser, {
            orderId: orderA.orderLegacyId,
        });
        expect(payout.viewerIsSeller).toBe(false);
    });

    it('refuses another buyer', async () => {
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.query(api.orders.getPayoutContextForCurrentUser, { orderId: orderA.orderLegacyId }),
        ).rejects.toThrow();
    });

    it('refuses another seller', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.query(api.orders.getPayoutContextForCurrentUser, { orderId: orderA.orderLegacyId }),
        ).rejects.toThrow();
    });

    it('refuses an anonymous caller', async () => {
        await expect(
            t.query(api.orders.getPayoutContextForCurrentUser, { orderId: orderA.orderLegacyId }),
        ).rejects.toThrow();
    });

    it('only lists the caller´s own orders', async () => {
        await seedOrder(t, 'ORD-B', buyerB, shopB);
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        const orders = await asBuyerA.query(api.orders.listMine, {});
        expect(orders.map((order: any) => order.publicId)).toEqual(['ORD-A']);
    });

    it('refuses to list the orders of a shop the caller does not own', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.query(api.orders.listForShop, { shopLegacyId: shopA.shopLegacyId }),
        ).rejects.toThrow();
    });
});

describe('order mutations', () => {
    it('refuses a delivery confirmation from someone who is not the buyer', async () => {
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.mutation(api.orders.confirmDeliveryForBuyer, { orderId: orderA.orderLegacyId }),
        ).rejects.toThrow();
    });

    it('refuses to hide an order that belongs to another buyer', async () => {
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.mutation(api.orders.hideForCurrentBuyer, { orderId: orderA.orderLegacyId }),
        ).rejects.toThrow();
    });

    it('refuses to cancel an order belonging to another seller´s shop', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.mutation(api.orders.cancelForSeller, {
                orderId: orderA.orderLegacyId,
                refundAmountCents: 2300,
                currency: 'eur',
            }),
        ).rejects.toThrow();
    });

    it('leaves imported orders untouchable', async () => {
        // Pre-migration orders keep their UUID id and are read-only, so a
        // historical pending order cannot reserve stock a second time.
        const imported = await seedOrder(t, 'ORD-LEGACY', buyerA, shopA);
        await t.run(async (ctx) => {
            const order = await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', imported.orderLegacyId))
                .unique();
            await ctx.db.patch(order!._id, { legacyId: '8f14e45f-ceea-467a-9a2c-4b0d3f5a1111' });
        });
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await expect(
            asBuyerA.mutation(api.orders.confirmDeliveryForBuyer, {
                orderId: '8f14e45f-ceea-467a-9a2c-4b0d3f5a1111',
            }),
        ).rejects.toThrow();
    });
});

describe('seller catalog', () => {
    it('refuses to toggle a product owned by another shop', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.mutation(api.seller.toggleProduct, { productId: shopA.productLegacyId, isActive: false }),
        ).rejects.toThrow(/access denied/i);
    });

    it('refuses to update a product owned by another shop', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.mutation(api.seller.updateProduct, { productId: shopA.productLegacyId, title: 'Hijacked' }),
        ).rejects.toThrow(/access denied/i);
    });

    it('refuses to delete a product owned by another shop', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.mutation(api.seller.deleteProduct, { productId: shopA.productLegacyId }),
        ).rejects.toThrow(/access denied/i);
    });

    it('does not expose another shop´s product through the seller product query', async () => {
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        expect(await asSellerB.query(api.seller.product, { productId: shopA.productLegacyId })).toBeNull();
    });

    it('scopes the seller dashboard to the caller´s own shop', async () => {
        const asSellerA = t.withIdentity(identity(SELLER_A, 'a@fewya.test'));
        const seller = await asSellerA.query(api.seller.current, {});
        expect(seller?.shop?.slug).toBe('shop-a');
        expect((seller?.products ?? []).map((product: any) => product.id)).toEqual([shopA.productLegacyId]);
    });
});

describe('reviews', () => {
    it('refuses a review for a product the caller never bought', async () => {
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.mutation(api.reviews.submitBatch, {
                reviews: [{ productId: shopA.productLegacyId, rating: 5 }],
            }),
        ).rejects.toThrow();
    });

    it('refuses a review while the order is not confirmed', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await expect(
            asBuyerA.mutation(api.reviews.submitBatch, {
                reviews: [{ productId: shopA.productLegacyId, rating: 5 }],
            }),
        ).rejects.toThrow();
    });

    it('accepts a review once the purchase is confirmed', async () => {
        await t.run(async (ctx) => {
            const order = await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
                .unique();
            await ctx.db.patch(order!._id, { status: 'confirmed' });
        });
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await asBuyerA.mutation(api.reviews.submitBatch, {
            reviews: [{ productId: shopA.productLegacyId, rating: 5, comment: 'great' }],
        });
        const stored = await t.run(async (ctx) => ctx.db.query('reviews').collect());
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ rating: 5, isAuto: false });
    });

    it('refuses a reply to a review on another shop´s product', async () => {
        const reviewId = await t.run(async (ctx) => {
            const id = await ctx.db.insert('reviews', {
                legacyId: 'review-a',
                productId: shopA.productId,
                productLegacyId: shopA.productLegacyId,
                rating: 4,
                isAuto: false,
                createdAt: 1_760_000_000_000,
            });
            return (await ctx.db.get(id))!.legacyId;
        });
        const asSellerB = t.withIdentity(identity(SELLER_B, 'b@fewya.test'));
        await expect(
            asSellerB.mutation(api.seller.replyReview, { reviewId, reply: 'not mine' }),
        ).rejects.toThrow();
    });
});

describe('wishlist', () => {
    it('returns only the caller´s own entries', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await asBuyerA.mutation(api.wishlist.toggle, { productLegacyId: shopA.productLegacyId });
        await asBuyerB.mutation(api.wishlist.toggle, { productLegacyId: shopB.productLegacyId });

        expect(await asBuyerA.query(api.wishlist.mine, {})).toEqual([shopA.productLegacyId]);
        expect(await asBuyerB.query(api.wishlist.mine, {})).toEqual([shopB.productLegacyId]);
    });

    it('refuses an anonymous toggle', async () => {
        await expect(
            t.mutation(api.wishlist.toggle, { productLegacyId: shopA.productLegacyId }),
        ).rejects.toThrow();
    });
});

describe('payment confirmation', () => {
    const SECRET = 'deployment-secret';

    beforeEach(async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        await t.run(async (ctx) => {
            const order = await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
                .unique();
            await ctx.db.patch(order!._id, {
                status: 'pending',
                paymentStatus: 'pending',
                stripeCheckoutSessionId: 'cs_1',
                deliveredAt: undefined,
            });
        });
    });

    // Being the buyer does not prove payment: without this the buyer of an
    // abandoned checkout could mark it paid, reserve the stock and have the
    // seller ship it for free.
    it('refuses to mark orders paid without the deployment secret', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await expect(
            asBuyerA.mutation(api.orders.markPaidForCurrentUser, {
                secret: 'wrong',
                sessionId: 'cs_1',
                paymentIntentId: 'pi_1',
            }),
        ).rejects.toThrow();

        const order = await t.run(async (ctx) => ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
            .unique());
        expect(order?.paymentStatus).toBe('pending');
    });

    it('marks them paid and reserves stock once the Worker vouches for the payment', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await asBuyerA.mutation(api.orders.markPaidForCurrentUser, {
            secret: SECRET,
            sessionId: 'cs_1',
            paymentIntentId: 'pi_1',
        });

        const { order, variant } = await t.run(async (ctx) => ({
            order: await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
                .unique(),
            variant: await ctx.db.get(shopA.variantId),
        }));
        expect(order?.paymentStatus).toBe('paid');
        expect(variant?.stock).toBe(4);
    });

    it('will not mark another buyer´s orders paid', async () => {
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.mutation(api.orders.markPaidForCurrentUser, {
                secret: SECRET,
                sessionId: 'cs_1',
                paymentIntentId: 'pi_1',
            }),
        ).rejects.toThrow();
    });
});

describe('deployment-secret functions', () => {
    const SECRET = 'deployment-secret';

    beforeEach(() => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
    });

    it('accept the deployment secret', async () => {
        await t.mutation(api.orders.recordFundsRelease, {
            secret: SECRET,
            orderId: orderA.orderLegacyId,
            success: true,
        });
        const order = await t.run(async (ctx) => ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
            .unique());
        expect(order?.fundsReleaseStatus).toBe('released');
    });

    it('refuse a wrong secret', async () => {
        await expect(
            t.mutation(api.orders.recordFundsRelease, {
                secret: 'wrong',
                orderId: orderA.orderLegacyId,
                success: true,
            }),
        ).rejects.toThrow();
        await expect(
            t.query(api.orders.listAutoConfirmCandidates, { secret: 'wrong', cutoff: Date.now() }),
        ).rejects.toThrow();
    });

    // A signed-in user is not a privileged caller: the secret is the only key.
    it('are not reachable with a mere signed-in identity', async () => {
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        await expect(
            asBuyerA.mutation(api.orders.recordFundsRelease, {
                secret: '',
                orderId: orderA.orderLegacyId,
                success: true,
            }),
        ).rejects.toThrow();
    });

    it('refuse everything when the deployment has no secret configured', async () => {
        delete process.env.CONVEX_WEBHOOK_SECRET;
        await expect(
            t.mutation(api.orders.recordFundsRelease, {
                secret: SECRET,
                orderId: orderA.orderLegacyId,
                success: true,
            }),
        ).rejects.toThrow();
    });
});

describe('shipment label references', () => {
    async function seedShipment() {
        return await t.run(async (ctx) => {
            const order = await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderA.orderLegacyId))
                .unique();
            await ctx.db.insert('shipments', {
                legacyId: 'convex:shipment:sc-1',
                orderId: order!._id,
                orderLegacyId: order!.legacyId,
                sendcloudShipmentId: 'sc-1',
                status: 'shipped',
                createdAt: 1_760_000_000_000,
                updatedAt: 1_760_000_000_000,
            });
        });
    }

    // The stored label URL is later fetched with the Sendcloud API
    // credentials attached, so an arbitrary address written here would
    // exfiltrate them.
    it('accepts only a Convex Storage marker', async () => {
        await seedShipment();
        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));

        await expect(
            asBuyerA.mutation(api.orders.updateShipmentLabelUrl, {
                shipmentId: 'sc-1',
                labelUrl: 'https://attacker.example/collect',
            }),
        ).rejects.toThrow(/invalid label reference/i);

        await asBuyerA.mutation(api.orders.updateShipmentLabelUrl, {
            shipmentId: 'sc-1',
            labelUrl: 'convex-storage:abc123',
        });
        const shipment = await t.run(async (ctx) => ctx.db
            .query('shipments')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', 'convex:shipment:sc-1'))
            .unique());
        expect(shipment?.labelUrl).toBe('convex-storage:abc123');
    });

    it('refuses a caller who is neither the buyer nor the seller', async () => {
        await seedShipment();
        const asBuyerB = t.withIdentity(identity(BUYER_B, 'buyer-b@fewya.test'));
        await expect(
            asBuyerB.mutation(api.orders.updateShipmentLabelUrl, {
                shipmentId: 'sc-1',
                labelUrl: 'convex-storage:abc123',
            }),
        ).rejects.toThrow();
    });
});

describe('storage resolution', () => {
    // Labels carry the buyer's address and incident photos are dispute
    // evidence, so resolving a storage id is not something an anonymous
    // caller may do — even holding the id.
    it('refuses to resolve a storage id for an anonymous caller', async () => {
        const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(['pdf'])));
        await expect(t.query(api.storage.getUrl, { storageId })).rejects.toThrow();

        const asBuyerA = t.withIdentity(identity(BUYER_A, 'buyer-a@fewya.test'));
        expect(await asBuyerA.query(api.storage.getUrl, { storageId })).toBeTruthy();
    });

    it('refuses to resolve an imported storage path for an anonymous caller', async () => {
        await expect(
            t.query(api.storage.resolveLegacyUrl, {
                url: 'https://x.supabase.co/storage/v1/object/public/labels/ORD-1.pdf',
            }),
        ).rejects.toThrow();
    });
});
