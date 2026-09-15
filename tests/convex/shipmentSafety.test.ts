/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import {
    identity,
    newTestHarness,
    seedBuyer,
    seedOrder,
    seedTenant,
    type Harness,
    type SeededTenant,
} from './fixtures';

const SELLER = 'clerk|shipping-seller';
const BUYER = 'clerk|shipping-buyer';

let t: Harness;
let seller: SeededTenant;
let orderId: string;
const previousWebhookSecret = process.env.CONVEX_WEBHOOK_SECRET;

const shipmentInput = (overrides: Record<string, unknown> = {}) => ({
    orderId,
    sendcloudShipmentId: '900001',
    sendcloudReference: 'ORD-SHIPPING',
    carrierId: 'correos:home,national',
    carrierName: 'Correos',
    serviceName: 'Home delivery',
    priceCents: 224,
    currency: 'EUR',
    labelUrl: 'convex-storage:label-fixture-id',
    ...overrides,
});

async function persistedState() {
    return await t.run(async (ctx) => {
        const order = await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', orderId)).unique();
        return {
            orderStatus: order?.status,
            shipments: await ctx.db.query('shipments').collect(),
        };
    });
}

beforeEach(async () => {
    process.env.CONVEX_WEBHOOK_SECRET = 'shipping-test-secret';
    t = newTestHarness();
    seller = await seedTenant(t, 'shipping-seller', SELLER);
    const buyer = await seedBuyer(t, 'shipping-buyer', BUYER);
    const order = await seedOrder(t, 'ORD-SHIPPING', buyer, seller, {
        status: 'paid',
        buyerEmail: 'clerk-user_fixture@invalid.local',
        shippingFullName: 'Buyer Fixture',
        shippingAddress: 'Test Street 2, 08001 Barcelona',
    });
    orderId = order.orderLegacyId;
});

afterEach(() => {
    if (previousWebhookSecret === undefined) delete process.env.CONVEX_WEBHOOK_SECRET;
    else process.env.CONVEX_WEBHOOK_SECRET = previousWebhookSecret;
});

describe('shipment persistence invariant', () => {
    it.each([
        ['an empty provider id', { sendcloudShipmentId: ' ' }],
        ['an empty label', { labelUrl: ' ' }],
        ['an arbitrary URL', { labelUrl: 'https://example.test/not-a-label.pdf' }],
        ['an empty storage marker', { labelUrl: 'convex-storage:' }],
    ])('refuses %s without changing order status or recording cost', async (_name, overrides) => {
        const asSeller = t.withIdentity(identity(SELLER, 'shipping-seller@fewya.test'));
        await expect(asSeller.mutation(api.orders.createShipmentForSeller, shipmentInput(overrides))).rejects.toThrow();
        expect(await persistedState()).toEqual({ orderStatus: 'paid', shipments: [] });
    });

    it('persists a valid label and only then moves the order to processing', async () => {
        const asSeller = t.withIdentity(identity(SELLER, 'shipping-seller@fewya.test'));
        await expect(asSeller.mutation(api.orders.createShipmentForSeller, shipmentInput())).resolves.toMatchObject({
            status: 'label_ready',
            labelUrl: 'convex-storage:label-fixture-id',
        });
        const state = await persistedState();
        expect(state.orderStatus).toBe('processing');
        expect(state.shipments).toHaveLength(1);
        expect(state.shipments[0]).toMatchObject({ priceCents: 224, status: 'label_ready' });
    });
});

describe('buyer email boundary', () => {
    it('uses the verified buyer profile in shipment context and seller dashboard', async () => {
        const asSeller = t.withIdentity(identity(SELLER, 'shipping-seller@fewya.test'));
        const context = await asSeller.query(api.orders.getShipmentContext, { orderId });
        expect(context.buyerEmail).toBe('shipping-buyer@fewya.test');

        const orders = await asSeller.query(api.orders.listForShop, { shopLegacyId: seller.shopLegacyId });
        expect(orders).toHaveLength(1);
        expect(orders[0].buyerEmail).toBe('shipping-buyer@fewya.test');
        expect(JSON.stringify(orders)).not.toContain('@invalid.local');
    });

    it('claims buyer notifications for the verified profile email', async () => {
        const claim = await t.mutation(api.orders.claimNotification, {
            secret: 'shipping-test-secret',
            orderId,
            type: 'buyer_ready_to_send',
            recipient: 'buyer',
        });
        expect(claim).toMatchObject({
            claimed: true,
            recipientEmail: 'shipping-buyer@fewya.test',
        });
        expect(JSON.stringify(claim)).not.toContain('@invalid.local');
    });
});
