import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockReleaseAndRecordFunds } = vi.hoisted(() => ({ mockReleaseAndRecordFunds: vi.fn() }));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({}),
}));

vi.mock('../../src/lib/orders/convexPayout', () => ({
    releaseAndRecordFunds: mockReleaseAndRecordFunds,
}));

const { POST } = await import('../../src/pages/api/orders/retry-payout');

const payout = {
    id: 'convex:ORD-1',
    publicId: 'ORD-1',
    viewerIsSeller: true,
    fundsReleaseStatus: 'failed',
    fundsReleaseRequestedAt: 1_760_000_000_000,
    fundsReleasedAt: null,
    stripePaymentIntentId: 'pi_1',
    items: [{ shopId: 'shop-1' }],
    labelCostByShop: {},
};

function call(body: unknown) {
    const request = new Request('https://fewya.com/api/orders/retry-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/retry-payout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(payout);
        mockReleaseAndRecordFunds.mockResolvedValue({ success: true });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        expect((await call({ orderId: 'convex:ORD-1' })).status).toBe(401);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing', async () => {
        expect((await call({})).status).toBe(400);
    });

    // The buyer can read the same payout context, but the retry moves money to
    // the seller and is theirs alone to trigger.
    it('refuses a buyer of the order', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, viewerIsSeller: false });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(403);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('refuses when the funds have already been transferred', async () => {
        convex.query.mockResolvedValueOnce({
            ...payout,
            fundsReleaseStatus: 'released',
            fundsReleasedAt: 1_760_000_000_001,
        });
        expect((await call({ orderId: 'convex:ORD-1' })).status).toBe(400);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    // Nothing asked for a payout yet: the order has not been confirmed.
    it('refuses when no payout has been requested', async () => {
        convex.query.mockResolvedValueOnce({
            ...payout,
            fundsReleaseStatus: 'pending',
            fundsReleaseRequestedAt: null,
        });
        expect((await call({ orderId: 'convex:ORD-1' })).status).toBe(400);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    // A confirmation whose transfer never ran leaves the status at `pending`.
    // The seller is exactly as unpaid as after a recorded failure.
    it('retries a confirmed order whose release never ran', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, fundsReleaseStatus: 'pending' });
        expect((await call({ orderId: 'convex:ORD-1' })).status).toBe(200);
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(1);
    });

    it('retries the release for the seller on the happy path', async () => {
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(200);
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the retry fails again', async () => {
        mockReleaseAndRecordFunds.mockResolvedValueOnce({ success: false, error: 'still down' });
        expect((await call({ orderId: 'convex:ORD-1' })).status).toBe(500);
    });
});
