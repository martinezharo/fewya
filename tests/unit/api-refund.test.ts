import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockAuthRpc = vi.fn();
const mockOrderSingle = vi.fn();
const mockRefundsInsert = vi.fn();
const mockAdminRpc = vi.fn();
const mockStripeRefundCreate = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({
        auth: { getUser: mockGetUser },
        rpc: mockAuthRpc,
        from: (table: string) => {
            if (table === 'orders') {
                return {
                    select: () => ({ eq: () => ({ single: mockOrderSingle }) }),
                };
            }
            // refunds
            return { insert: mockRefundsInsert };
        },
    }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({ rpc: mockAdminRpc }),
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({ refunds: { create: mockStripeRefundCreate } }),
}));

const { POST } = await import('../../src/pages/api/orders/refund');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const paidOrder = {
    id: 'order-1',
    public_id: 'ORD-1',
    status: 'paid',
    stripe_payment_intent_id: 'pi_1',
    total_amount: 42.5,
};

describe('POST /api/orders/refund', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'seller-1' } } });
        mockAuthRpc.mockResolvedValue({ data: true }); // order_belongs_to_seller
        mockOrderSingle.mockResolvedValue({ data: paidOrder, error: null });
        mockAdminRpc.mockResolvedValue({ data: [{ id: 'order-1' }], error: null });
        mockStripeRefundCreate.mockResolvedValue({ id: 're_1' });
        mockRefundsInsert.mockResolvedValue({ error: null });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ orderId: 'order-1' })).status).toBe(401);
    });

    it('returns 400 when orderId is missing', async () => {
        expect((await call({})).status).toBe(400);
    });

    it('returns 403 when the seller does not own the order', async () => {
        mockAuthRpc.mockResolvedValueOnce({ data: false });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(403);
        expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    });

    it('returns 404 when the order cannot be found', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
        expect((await call({ orderId: 'order-1' })).status).toBe(404);
    });

    it('returns 400 when the order is not in a cancellable status', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: { ...paidOrder, status: 'shipped' }, error: null });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(400);
        expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    });

    it('refunds via Stripe in minor units and cancels the order on success', async () => {
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(200);
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(expect.objectContaining({
            payment_intent: 'pi_1',
            amount: 4250, // 42.50 EUR → cents
        }));
        expect(mockAdminRpc).toHaveBeenCalledWith('cancel_order', expect.objectContaining({
            p_actor_id: 'seller-1',
            p_order_id: 'order-1',
        }));
        expect(mockRefundsInsert).toHaveBeenCalled();
    });

    it('returns 500 when the cancel RPC fails', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
    });

    it('returns 500 when the Stripe refund throws', async () => {
        mockStripeRefundCreate.mockRejectedValueOnce(new Error('stripe down'));
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(500);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });
});
