import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockOrderSingle = vi.fn();
const mockUpdateEq3 = vi.fn(); // third .eq() in the update chain resolves the query

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: () => ({
            select: () => ({ eq: () => ({ eq: () => ({ single: mockOrderSingle }) }) }),
            update: () => ({ eq: () => ({ eq: () => ({ eq: mockUpdateEq3 }) }) }),
        }),
    }),
}));

const { POST } = await import('../../src/pages/api/orders/hide');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const pendingOrder = { id: 'order-1', status: 'pending', buyer_id: 'buyer-1' };

describe('POST /api/orders/hide', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1' } } });
        mockOrderSingle.mockResolvedValue({ data: pendingOrder, error: null });
        mockUpdateEq3.mockResolvedValue({ error: null });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ orderId: 'order-1' })).status).toBe(401);
    });

    it('returns 400 when orderId is missing', async () => {
        expect((await call({})).status).toBe(400);
    });

    it('returns 403 when the order does not belong to the caller (or does not exist)', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: null, error: null });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(403);
        expect(mockUpdateEq3).not.toHaveBeenCalled();
    });

    // Illegal transition: hiding is only allowed for orders still in 'pending'
    // (i.e. never paid). Any order that progressed past pending — paid,
    // processing, shipped, delivered, confirmed, cancelled, etc. — must be
    // rejected so buyers can't make already-active orders disappear from
    // their own order history.
    it.each(['paid', 'processing', 'shipped', 'delivered', 'confirmed', 'cancelled', 'incident', 'refunded'])(
        'returns 400 when the order status is %s instead of pending',
        async (status) => {
            mockOrderSingle.mockResolvedValueOnce({ data: { ...pendingOrder, status }, error: null });
            const res = await call({ orderId: 'order-1' });
            expect(res.status).toBe(400);
            expect(mockUpdateEq3).not.toHaveBeenCalled();
        },
    );

    it('hides the order and returns 200 when it is still pending', async () => {
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(200);
        expect(mockUpdateEq3).toHaveBeenCalled();
        expect(await res.json()).toMatchObject({ success: true });
    });

    it('returns 500 when the update fails', async () => {
        mockUpdateEq3.mockResolvedValueOnce({ error: { message: 'db down' } });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
    });
});
