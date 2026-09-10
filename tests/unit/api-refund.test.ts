import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockRefundsCreate } = vi.hoisted(() => ({ mockRefundsCreate: vi.fn() }));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({ refunds: { create: mockRefundsCreate } }),
}));

const { POST } = await import('../../src/pages/api/orders/refund');

const payout = {
    id: 'convex:ORD-1',
    publicId: 'ORD-1',
    status: 'paid',
    totalAmount: 42.5,
    stripePaymentIntentId: 'pi_1',
    items: [{ shopId: 'shop-1', shippingCost: 5, stripeAccountId: 'acct_1' }],
    labelCostByShop: {},
};

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/refund', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(payout);
        convex.mutation.mockResolvedValue({ success: true, orderId: 'convex:ORD-1' });
        mockRefundsCreate.mockResolvedValue({ id: 're_1' });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(401);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing', async () => {
        expect((await call({})).status).toBe(400);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 500 without refunding when the seller does not own the order', async () => {
        convex.query.mockRejectedValueOnce(new Error('Order access required'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when the order is not in a cancellable status', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, status: 'shipped' });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiOrderCannotBeCancelled });
        expect(mockRefundsCreate).not.toHaveBeenCalled();
    });

    it('refunds via Stripe in minor units and cancels the order on success', async () => {
        const res = await call({ orderId: 'convex:ORD-1', cancellationReason: 'out of stock' });
        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1', amount: 4250 }),
            expect.objectContaining({ idempotencyKey: 'cancel-refund:convex:ORD-1' }),
        );
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                orderId: 'convex:ORD-1',
                cancellationReason: 'out of stock',
                refundAmountCents: 4250,
                stripeRefundId: 're_1',
            }),
        );
    });

    it('returns 500 when the cancellation write fails', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('bad transition'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
    });

    it('returns 500 without cancelling when the Stripe refund throws', async () => {
        mockRefundsCreate.mockRejectedValueOnce(new Error('card_error'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
        expect(convex.mutation).not.toHaveBeenCalled();
    });
});
