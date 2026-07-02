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

const { POST } = await import('../../src/pages/api/orders/refund-incident');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/refund-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const incidentOrder = {
    id: 'order-1',
    public_id: 'ORD-1',
    status: 'incident',
    stripe_payment_intent_id: 'pi_1',
    total_amount: 50,
};

const orderItems = [
    {
        product_variants: {
            shipping_cost: 5,
            products: {
                shops: {
                    id: 'shop-1',
                    shop_payment_accounts: { stripe_account_id: 'acct_1' },
                },
            },
        },
    },
];

describe('POST /api/orders/refund-incident', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'seller-1' } } });
        mockAuthRpc.mockResolvedValue({ data: true }); // order_belongs_to_seller
        mockOrderSingle.mockResolvedValue({ data: incidentOrder, error: null });
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

    it('returns 400 when the order is not in incident status', async () => {
        mockOrderSingle.mockResolvedValueOnce({ data: { ...incidentOrder, status: 'delivered' }, error: null });
        const res = await call({ orderId: 'order-1' });
        expect(res.status).toBe(400);
        expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when the order items cannot be fetched', async () => {
        mockItemsEq.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        expect((await call({ orderId: 'order-1' })).status).toBe(500);
    });

    it('rejects a partial refund amount that is zero, negative or above the total', async () => {
        for (const partialAmount of [0, -1, 50.01]) {
            const res = await call({ orderId: 'order-1', refundType: 'partial', partialAmount });
            expect(res.status).toBe(400);
        }
        expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    });

    it('refunds the full total without a shipping transfer for a full refund', async () => {
        const res = await call({ orderId: 'order-1', refundType: 'full' });
        expect(res.status).toBe(200);
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1', amount: 5000 }),
            expect.anything(),
        );
        expect(mockTransferCreate).not.toHaveBeenCalled();
        expect(mockAdminRpc).toHaveBeenCalledWith('resolve_incident_with_refund', {
            p_actor_id: 'seller-1',
            p_order_id: 'order-1',
        });
        expect(mockRefundsInsert).toHaveBeenCalledWith(expect.objectContaining({
            order_id: 'order-1',
            amount: 50,
            reason: 'incident_refund_full',
        }));
        expect(await res.json()).toMatchObject({ success: true, refundedAmount: 50, shippingRetained: 0 });
    });

    it('refunds product price and transfers the shipping to the seller for a product refund', async () => {
        const res = await call({ orderId: 'order-1', refundType: 'product' });
        expect(res.status).toBe(200);
        // 50 total − 5 max shipping = 45.00 → 4500 cents refunded to the buyer.
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 4500 }),
            expect.anything(),
        );
        // Shipping (5.00 → 500 cents) paid out to the seller on the PI transfer group.
        expect(mockTransferCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                amount: 500,
                destination: 'acct_1',
                transfer_group: 'order_ORD-1',
            }),
            expect.anything(),
        );
        expect(await res.json()).toMatchObject({ refundedAmount: 45, shippingRetained: 5 });
    });

    it('refunds exactly the requested amount for a partial refund', async () => {
        const res = await call({ orderId: 'order-1', refundType: 'partial', partialAmount: 12.34 });
        expect(res.status).toBe(200);
        expect(mockStripeRefundCreate).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 1234 }),
            expect.anything(),
        );
        expect(mockTransferCreate).not.toHaveBeenCalled();
        expect(await res.json()).toMatchObject({ refundedAmount: 12.34 });
    });

    it('returns 500 when the incident-resolution RPC fails', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
        expect((await call({ orderId: 'order-1', refundType: 'full' })).status).toBe(500);
    });

    it('returns 500 without resolving the incident when the Stripe refund throws', async () => {
        mockStripeRefundCreate.mockRejectedValueOnce(new Error('stripe down'));
        const res = await call({ orderId: 'order-1', refundType: 'full' });
        expect(res.status).toBe(500);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });
});
