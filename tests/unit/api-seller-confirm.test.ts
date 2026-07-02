import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';
import { FUND_HOLD_MS } from '../../src/lib/orders/timing';

const mockGetUser = vi.fn();
const mockOrderSingle = vi.fn();
const mockOrderUpdate = vi.fn();
const mockOrderUpdateEq = vi.fn();
const mockFetchAndReleaseFunds = vi.fn();
const mockCreateAutoReviews = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: () => ({
            select: () => ({ eq: () => ({ single: mockOrderSingle }) }),
            update: (payload: unknown) => {
                mockOrderUpdate(payload);
                return { eq: mockOrderUpdateEq };
            },
        }),
    }),
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({}),
}));

vi.mock('../../src/lib/orders/payoutFlow', () => ({
    fetchAndReleaseFunds: mockFetchAndReleaseFunds,
}));

vi.mock('../../src/lib/orders/autoReview', () => ({
    createAutoReviewsForOrder: mockCreateAutoReviews,
}));

const { POST } = await import('../../src/pages/api/orders/seller-confirm');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/seller-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const pastHold = new Date(Date.now() - FUND_HOLD_MS - 60_000).toISOString();

function deliveredOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 'order-1',
        public_id: 'ORD-1',
        status: 'delivered',
        delivered_at: pastHold,
        funds_released_at: null,
        stripe_payment_intent_id: 'pi_1',
        shops: { id: 'shop-1', owner_id: 'seller-1' },
        ...overrides,
    };
}

describe('POST /api/orders/seller-confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'seller-1' } } });
        mockOrderSingle.mockResolvedValue({ data: deliveredOrder(), error: null });
        mockOrderUpdateEq.mockResolvedValue({ error: null });
        mockFetchAndReleaseFunds.mockResolvedValue({ success: true });
        mockCreateAutoReviews.mockResolvedValue(undefined);
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ orderId: 'order-1' })).status).toBe(401);
    });

    it('returns 400 on malformed JSON or missing orderId', async () => {
        expect((await call(null, { rawBody: '{oops' })).status).toBe(400);
        expect((await call({})).status).toBe(400);
    });

    it('returns 403 when the order cannot be found', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
        expect((await call({ orderId: 'order-1' })).status).toBe(403);
    });

    it('returns 403 when the caller does not own the shop', async () => {
        mockOrderSingle.mockResolvedValueOnce({
            data: deliveredOrder({ shops: { id: 'shop-1', owner_id: 'someone-else' } }),
            error: null,
        });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(403);
        expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when the order is not in delivered status', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: deliveredOrder({ status: 'shipped' }), error: null });
        expect((await call({ orderId: 'order-1' })).status).toBe(400);
    });

    it('returns 400 while the fund-hold window is still open', async () => {
        mockOrderSingle.mockResolvedValueOnce({
            data: deliveredOrder({ delivered_at: new Date().toISOString() }),
            error: null,
        });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(400);
        expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('is idempotent: returns 200 without re-releasing when funds were already released', async () => {
        mockOrderSingle.mockResolvedValueOnce({
            data: deliveredOrder({ funds_released_at: pastHold }),
            error: null,
        });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(200);
        expect(mockOrderUpdate).not.toHaveBeenCalled();
        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
    });

    it('returns 500 without releasing funds when the confirm update fails', async () => {
        mockOrderUpdateEq.mockResolvedValueOnce({ error: { message: 'db down' } });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
    });

    it('returns 500 when the fund release fails after confirmation', async () => {
        mockFetchAndReleaseFunds.mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        expect((await call({ orderId: 'order-1' })).status).toBe(500);
    });

    it('confirms the order, releases funds and creates auto-reviews on the happy path', async () => {
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(200);
        expect(mockOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'confirmed',
            funds_released_at: expect.any(String),
        }));
        expect(mockFetchAndReleaseFunds).toHaveBeenCalledWith(expect.objectContaining({
            order: expect.objectContaining({ id: 'order-1', stripe_payment_intent_id: 'pi_1' }),
        }));
        expect(mockCreateAutoReviews).toHaveBeenCalledWith('order-1', en);
        expect(await res.json()).toMatchObject({ success: true, orderId: 'order-1', publicId: 'ORD-1' });
    });
});
