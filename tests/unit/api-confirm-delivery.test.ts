import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockAdminRpc = vi.fn();
const mockFetchPayoutItems = vi.fn();
const mockValidatePayoutDestinations = vi.fn();
const mockReleaseAndRecord = vi.fn();
const mockCreateAutoReviews = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({ rpc: mockAdminRpc }),
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({}),
}));

vi.mock('../../src/lib/payments/payoutValidation', () => ({
    validatePayoutDestinations: mockValidatePayoutDestinations,
}));

vi.mock('../../src/lib/orders/payoutFlow', () => ({
    fetchPayoutItems: mockFetchPayoutItems,
    releaseAndRecord: mockReleaseAndRecord,
}));

vi.mock('../../src/lib/orders/autoReview', () => ({
    createAutoReviewsForOrder: mockCreateAutoReviews,
}));

const { POST } = await import('../../src/pages/api/orders/confirm-delivery');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/confirm-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

describe('POST /api/orders/confirm-delivery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
        mockFetchPayoutItems.mockResolvedValue({ items: [{ shopId: 'shop-1' }], error: null });
        mockValidatePayoutDestinations.mockResolvedValue([]);
        mockAdminRpc.mockResolvedValue({
            data: [{ id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' }],
            error: null,
        });
        mockReleaseAndRecord.mockResolvedValue({ success: true });
        mockCreateAutoReviews.mockResolvedValue(undefined);
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(401);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing', async () => {
        const res = await call({});
        expect(res.status).toBe(400);
    });

    it('returns 500 without confirming when payout items cannot be fetched', async () => {
        mockFetchPayoutItems.mockResolvedValueOnce({ items: [], error: 'db down' });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns 400 without confirming when a payout destination is invalid', async () => {
        mockValidatePayoutDestinations.mockResolvedValueOnce(['shop-1: charges disabled']);
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(400);
        // Status must NOT be flipped when the destination is unusable.
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns 400 when the confirm RPC fails', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'bad transition' } });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(400);
        expect(mockReleaseAndRecord).not.toHaveBeenCalled();
    });

    it('returns 500 when fund release fails after confirmation', async () => {
        mockReleaseAndRecord.mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
    });

    it('confirms, releases funds and returns 200 on the happy path', async () => {
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(200);
        expect(mockAdminRpc).toHaveBeenCalledWith('confirm_order_delivery', {
            p_actor_id: 'user-1',
            p_order_id: 'order-1',
        });
        expect(mockReleaseAndRecord).toHaveBeenCalledTimes(1);
        expect(mockCreateAutoReviews).toHaveBeenCalledWith('order-1', en);
        expect(await res.json()).toMatchObject({ success: true, orderId: 'order-1', publicId: 'ORD-1' });
    });
});
