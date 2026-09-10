import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockRefundsCreate, mockTransfersCreate, mockPaymentIntentsRetrieve } = vi.hoisted(() => ({
    mockRefundsCreate: vi.fn(),
    mockTransfersCreate: vi.fn(),
    mockPaymentIntentsRetrieve: vi.fn(),
}));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({
        refunds: { create: mockRefundsCreate },
        transfers: { create: mockTransfersCreate },
        paymentIntents: { retrieve: mockPaymentIntentsRetrieve },
    }),
}));

const { POST } = await import('../../src/pages/api/orders/refund-incident');

/** 40.00 total = 35.00 product + 5.00 shipping. */
const payout = {
    id: 'convex:ORD-1',
    publicId: 'ORD-1',
    status: 'incident',
    totalAmount: 40,
    stripePaymentIntentId: 'pi_1',
    items: [{ shopId: 'shop-1', shippingCost: 5, stripeAccountId: 'acct_1' }],
    labelCostByShop: {},
};

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/refund-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/refund-incident', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(payout);
        convex.mutation.mockResolvedValue({ success: true, orderId: 'convex:ORD-1' });
        mockRefundsCreate.mockResolvedValue({ id: 're_1' });
        mockTransfersCreate.mockResolvedValue({ id: 'tr_1' });
        mockPaymentIntentsRetrieve.mockResolvedValue({ transfer_group: 'order_ORD-1' });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(401);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing or refundType is invalid', async () => {
        expect((await call({ refundType: 'full' })).status).toBe(400);
        expect((await call({ orderId: 'convex:ORD-1', refundType: 'nope' })).status).toBe(400);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 500 without refunding when the seller cannot reach the order', async () => {
        // Convex authorizes the read; a foreign order id throws.
        convex.query.mockRejectedValueOnce(new Error('Order access required'));
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(500);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when the order is not in incident status', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, status: 'delivered' });
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(400);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('rejects a partial refund amount that is zero, negative or above the total', async () => {
        for (const partialAmount of [0, -5, 40.01]) {
            const res = await call({ orderId: 'convex:ORD-1', refundType: 'partial', partialAmount });
            expect(res.status).toBe(400);
        }
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('refunds the full total without a shipping transfer for a full refund', async () => {
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1', amount: 4000 }),
            expect.objectContaining({ idempotencyKey: 'incident-refund-full-4000:convex:ORD-1' }),
        );
        expect(mockTransfersCreate).not.toHaveBeenCalled();
    });

    it('refunds product price and transfers the shipping to the seller for a product refund', async () => {
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'product' });
        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 3500 }),
            expect.anything(),
        );
        expect(mockTransfersCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 500, destination: 'acct_1' }),
            expect.objectContaining({ idempotencyKey: 'incident-shipping-transfer:convex:ORD-1' }),
        );
        expect(await res.json()).toMatchObject({ refundType: 'product', refundedAmount: 35, shippingRetained: 5 });
    });

    it('refunds exactly the requested amount for a partial refund', async () => {
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'partial', partialAmount: 12.5 });
        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 1250 }),
            expect.anything(),
        );
        expect(mockTransfersCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when the incident resolution write fails', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('bad transition'));
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(500);
    });

    it('returns 500 without resolving the incident when the Stripe refund throws', async () => {
        mockRefundsCreate.mockRejectedValueOnce(new Error('card_error'));
        const res = await call({ orderId: 'convex:ORD-1', refundType: 'full' });
        expect(res.status).toBe(500);
        expect(convex.mutation).not.toHaveBeenCalled();
    });
});
