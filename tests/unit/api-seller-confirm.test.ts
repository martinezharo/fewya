import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';
import { FUND_HOLD_MS } from '../../src/lib/orders/timing';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockValidatePayoutDestinations, mockReleaseAndRecordFunds, mockCreateAutoReviews } = vi.hoisted(() => ({
    mockValidatePayoutDestinations: vi.fn(),
    mockReleaseAndRecordFunds: vi.fn(),
    mockCreateAutoReviews: vi.fn(),
}));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({}),
}));

vi.mock('../../src/lib/payments/payoutValidation', () => ({
    validatePayoutDestinations: mockValidatePayoutDestinations,
}));

vi.mock('../../src/lib/orders/convexPayout', () => ({
    releaseAndRecordFunds: mockReleaseAndRecordFunds,
    createAutoReviews: mockCreateAutoReviews,
}));

const { POST } = await import('../../src/pages/api/orders/seller-confirm');

/** Delivered long enough ago that the buyer's dispute window has closed. */
const deliveredPastHold = Date.now() - FUND_HOLD_MS - 60_000;

const payout = {
    id: 'convex:ORD-1',
    publicId: 'ORD-1',
    status: 'delivered',
    deliveredAt: deliveredPastHold,
    stripePaymentIntentId: 'pi_1',
    items: [{ shopId: 'shop-1' }],
    labelCostByShop: {},
};

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/seller-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/seller-confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(payout);
        convex.mutation.mockResolvedValue({ orderId: 'convex:ORD-1', publicId: 'ORD-1' });
        mockValidatePayoutDestinations.mockResolvedValue([]);
        mockReleaseAndRecordFunds.mockResolvedValue({ success: true });
        mockCreateAutoReviews.mockResolvedValue(undefined);
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON or missing orderId', async () => {
        expect((await call(undefined, { rawBody: '{' })).status).toBe(400);
        expect((await call({})).status).toBe(400);
    });

    it('returns 500 when the caller does not own the order shop', async () => {
        // Convex authorizes the read: a seller who does not own the shop is refused.
        convex.query.mockRejectedValueOnce(new Error('Order access required'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 when the order is not in delivered status', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, status: 'shipped' });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 while the fund-hold window is still open', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, deliveredAt: Date.now() - 60_000 });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('returns 400 without releasing when a payout destination is invalid', async () => {
        mockValidatePayoutDestinations.mockResolvedValueOnce(['shop-1: payouts disabled']);
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 500 when the fund release fails after confirmation', async () => {
        mockReleaseAndRecordFunds.mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
        expect(mockCreateAutoReviews).not.toHaveBeenCalled();
    });

    it('confirms the order, releases funds and creates auto-reviews on the happy path', async () => {
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(200);
        // The cutoff is passed to Convex so the window is re-checked on write.
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ orderId: 'convex:ORD-1', cutoff: expect.any(Number) }),
        );
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(1);
        expect(mockCreateAutoReviews).toHaveBeenCalledTimes(1);
        expect(await res.json()).toMatchObject({ success: true, orderId: 'convex:ORD-1' });
    });
});
