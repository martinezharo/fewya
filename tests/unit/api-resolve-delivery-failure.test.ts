import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockAuthRpc = vi.fn();
const mockOrderSingle = vi.fn();
const mockItemsEq = vi.fn();
const mockRefundsInsert = vi.fn();
const mockAdminRpc = vi.fn();
const mockStripeRefundCreate = vi.fn();
const mockPaymentIntentRetrieve = vi.fn();
const mockTransferCreate = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({
        auth: { getUser: mockGetUser },
        rpc: mockAuthRpc,
        from: (table: string) => {
            if (table === 'orders') {
                return { select: () => ({ eq: () => ({ single: mockOrderSingle }) }) };
            }
            if (table === 'order_items') {
                return { select: () => ({ eq: mockItemsEq }) };
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
    getStripeClient: () => ({
        refunds: { create: mockStripeRefundCreate },
        paymentIntents: { retrieve: mockPaymentIntentRetrieve },
        transfers: { create: mockTransferCreate },
    }),
}));

const { POST } = await import('../../src/pages/api/orders/resolve-delivery-failure');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/resolve-delivery-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const deliveryFailedOrder = {
    id: 'order-1',
    public_id: 'ORD-1',
    status: 'delivery_failed',
    stripe_payment_intent_id: 'pi_1',
    total_amount: 60,
};

const orderItems = [
    {
        product_variants: {
            shipping_cost: 6,
            products: {
                shops: {
                    id: 'shop-1',
                    shop_payment_accounts: { stripe_account_id: 'acct_1' },
                },
            },
        },
    },
];

describe('POST /api/orders/resolve-delivery-failure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'seller-1' } } });
        mockAuthRpc.mockResolvedValue({ data: true }); // order_belongs_to_seller
        mockOrderSingle.mockResolvedValue({ data: deliveryFailedOrder, error: null });
        mockItemsEq.mockResolvedValue({ data: orderItems, error: null });
        mockAdminRpc.mockResolvedValue({ data: [{ id: 'order-1' }], error: null });
        mockStripeRefundCreate.mockResolvedValue({ id: 're_1' });
        mockPaymentIntentRetrieve.mockResolvedValue({ transfer_group: 'order_ORD-1' });
        mockTransferCreate.mockResolvedValue({ id: 'tr_1' });
        mockRefundsInsert.mockResolvedValue({ error: null });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ orderId: 'order-1' })).status).toBe(401);
    });

    it('returns 400 when orderId is missing or refundType is invalid', async () => {
        expect((await call({})).status).toBe(400);
        expect((await call({ orderId: 'order-1', refundType: 'bogus' })).status).toBe(400);
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

    // Illegal transition: this route only resolves orders currently in
    // 'delivery_failed' (matching `resolve_delivery_failure_with_refund`'s
    // `WHERE status = 'delivery_failed'` guard in db-structure/02-orders.sql).
    // Every other status — including ones that sound superficially similar,
    // like 'shipped' or an already-'refunded' order — must be rejected before
    // any Stripe call is made.
    it.each(['shipped', 'delivered', 'incident', 'refunded', 'cancelled', 'paid'])(
        'returns 400 when the order status is %s instead of delivery_failed',
        async (status) => {
            mockOrderSingle.mockResolvedValueOnce({ data: { ...deliveryFailedOrder, status }, error: null });
            const res = await call({ orderId: 'order-1' });
            expect(res.status).toBe(400);
            expect(mockStripeRefundCreate).not.toHaveBeenCalled();
            expect(mockAdminRpc).not.toHaveBeenCalled();
        },
    );

    it('returns 500 when the order items cannot be fetched', async () => {
        mockItemsEq.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        expect((await call({ orderId: 'order-1' })).status).toBe(500);
    });

    it('refunds the full total without a shipping transfer for a full refund', async () => {
        const res = await call({ orderId: 'order-1', refundType: 'full' });
        expect(res.status).toBe(200);
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1', amount: 6000 }),
            expect.anything(),
        );
        expect(mockTransferCreate).not.toHaveBeenCalled();
        expect(mockAdminRpc).toHaveBeenCalledWith('resolve_delivery_failure_with_refund', {
            p_actor_id: 'seller-1',
            p_order_id: 'order-1',
        });
        expect(mockRefundsInsert).toHaveBeenCalledWith(expect.objectContaining({
            order_id: 'order-1',
            amount: 60,
            reason: 'delivery_failure_full',
        }));
    });

    it('refunds product price and transfers the shipping to the seller for a product refund', async () => {
        const res = await call({ orderId: 'order-1', refundType: 'product' });
        expect(res.status).toBe(200);
        // 60 total − 6 max shipping = 54.00 → 5400 cents refunded to the buyer.
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 5400 }),
            expect.anything(),
        );
        expect(mockTransferCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 600, destination: 'acct_1' }),
            expect.anything(),
        );
        expect(await res.json()).toMatchObject({ refundedAmount: 54, shippingRetained: 6 });
    });

    it('returns 500 when the resolve RPC fails', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
        expect((await call({ orderId: 'order-1', refundType: 'full' })).status).toBe(500);
    });

    it('returns 500 without resolving when the Stripe refund throws', async () => {
        mockStripeRefundCreate.mockRejectedValueOnce(new Error('stripe down'));
        const res = await call({ orderId: 'order-1', refundType: 'full' });
        expect(res.status).toBe(500);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });
});
