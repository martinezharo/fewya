import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

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

const { POST } = await import('../../src/pages/api/orders/cancel-incident');

const payout = {
    id: 'convex:ORD-1',
    publicId: 'ORD-1',
    status: 'incident',
    stripePaymentIntentId: 'pi_1',
    items: [{ shopId: 'shop-1' }],
    labelCostByShop: {},
};

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/cancel-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/cancel-incident', () => {
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

    it('returns 400 when orderId is missing', async () => {
        const res = await call({});
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON', async () => {
        const res = await call(undefined, { rawBody: '{' });
        expect(res.status).toBe(400);
    });

    it('returns 400 without confirming when the caller cannot reach the order', async () => {
        // Convex authorizes the read: a foreign order id throws instead of answering.
        convex.query.mockRejectedValueOnce(new Error('Order access required'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(mockValidatePayoutDestinations).not.toHaveBeenCalled();
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 without confirming when the order has no open incident', async () => {
        convex.query.mockResolvedValueOnce({ ...payout, status: 'delivered' });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 without confirming when a payout destination is invalid', async () => {
        mockValidatePayoutDestinations.mockResolvedValueOnce(['shop-1: charges disabled']);
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        // Status must NOT be flipped when the destination is unusable.
        expect(convex.mutation).not.toHaveBeenCalled();
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('returns 500 when fund release fails after confirmation', async () => {
        mockReleaseAndRecordFunds.mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(500);
        expect(mockCreateAutoReviews).not.toHaveBeenCalled();
    });

    it('confirms, releases funds and returns 200 on the happy path', async () => {
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledTimes(1);
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(1);
        expect(mockCreateAutoReviews).toHaveBeenCalledWith(
            expect.objectContaining({ orderId: 'convex:ORD-1', comment: en.autoReviewComment }),
        );
        expect(await res.json()).toMatchObject({ success: true, orderId: 'convex:ORD-1', publicId: 'ORD-1' });
    });
});
