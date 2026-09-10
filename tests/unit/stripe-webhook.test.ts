import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockConstructEventAsync,
    mockRefundsCreate,
    mockQuery,
    mockMutation,
    mockNotify,
} = vi.hoisted(() => ({
    mockConstructEventAsync: vi.fn(),
    mockRefundsCreate: vi.fn(),
    mockQuery: vi.fn(),
    mockMutation: vi.fn(),
    mockNotify: vi.fn(),
}));

vi.mock('astro:env/server', () => ({
    APP_MODE: 'production',
    STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_secret_test',
    STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_test_secret',
    STRIPE_SECRET_KEY_TEST: 'sk_test_key_test',
    STRIPE_SECRET_KEY_LIVE: 'sk_test_key',
    CONVEX_URL: 'https://mock.convex.cloud',
    CONVEX_WEBHOOK_SECRET: 'convex-webhook-mock',
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({
        webhooks: { constructEventAsync: mockConstructEventAsync },
        refunds: { create: mockRefundsCreate },
    }),
}));

vi.mock('../../src/lib/core/convex', () => ({
    createConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));

vi.mock('../../src/lib/notifications/dispatch', () => ({ notify: mockNotify }));

vi.mock('../../src/lib/core/security-log', () => ({
    securityLog: vi.fn(),
}));

const { POST } = await import('../../src/pages/api/webhooks/stripe');

function post(event: unknown, { signature = 'valid_sig' }: { signature?: string | null } = {}) {
    const request = new Request('https://fewya.com/api/webhooks/stripe', {
        method: 'POST',
        headers: signature ? { 'stripe-signature': signature } : {},
        body: JSON.stringify(event ?? {}),
    });
    return POST({ request } as any);
}

const checkoutCompleted = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_intent: 'pi_1' } },
};

describe('Stripe webhook handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNotify.mockResolvedValue({ sent: true });
        mockMutation.mockResolvedValue({ handled: true, requiresRefund: false, orders: [] });
    });

    it('returns 400 when the stripe-signature header is missing', async () => {
        const res = await post({}, { signature: null });
        expect(res.status).toBe(400);
        expect(mockMutation).not.toHaveBeenCalled();
    });

    it('returns 401 when the signature is invalid', async () => {
        mockConstructEventAsync.mockRejectedValueOnce(new Error('No signatures found'));
        const res = await post({}, { signature: 'bad_sig' });
        expect(res.status).toBe(401);
        expect(mockMutation).not.toHaveBeenCalled();
    });

    it('acknowledges an event type it does not act on', async () => {
        mockConstructEventAsync.mockResolvedValueOnce({
            id: 'evt_refund',
            type: 'charge.refunded',
            data: { object: { id: 'ch_1', amount_refunded: 1000 } },
        });
        const res = await post({});
        expect(res.status).toBe(200);
        expect(mockMutation).not.toHaveBeenCalled();
    });

    it('commits the payment and notifies the seller on the happy path', async () => {
        mockConstructEventAsync.mockResolvedValueOnce(checkoutCompleted);
        mockMutation.mockResolvedValueOnce({
            handled: true,
            requiresRefund: false,
            orders: [{ id: 'convex:ORD-1' }],
        });

        const res = await post(checkoutCompleted);

        expect(res.status).toBe(200);
        expect(mockMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ eventId: 'evt_1', sessionId: 'cs_1', paymentIntentId: 'pi_1' }),
        );
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
            orderId: 'convex:ORD-1',
            recipient: 'seller',
        }));
    });

    // Convex dedupes by event id: a replay comes back handled with nothing to do.
    it('returns 200 without re-notifying on a duplicate event', async () => {
        mockConstructEventAsync.mockResolvedValueOnce(checkoutCompleted);
        mockMutation.mockResolvedValueOnce({ handled: true, requiresRefund: false, orders: [] });

        const res = await post(checkoutCompleted);

        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('refunds the charge when the payment cannot be committed (e.g. insufficient stock)', async () => {
        mockConstructEventAsync.mockResolvedValueOnce(checkoutCompleted);
        mockMutation.mockResolvedValueOnce({
            handled: true,
            requiresRefund: true,
            failureReason: 'insufficient_stock',
            orders: [],
        });
        mockRefundsCreate.mockResolvedValueOnce({ id: 're_1' });

        const res = await post(checkoutCompleted);

        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1' }),
            expect.objectContaining({ idempotencyKey: 'mark-paid-failure-refund:cs_1' }),
        );
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('still acknowledges when the compensating refund itself fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockConstructEventAsync.mockResolvedValueOnce(checkoutCompleted);
        mockMutation.mockResolvedValueOnce({
            handled: true,
            requiresRefund: true,
            failureReason: 'insufficient_stock',
            orders: [],
        });
        mockRefundsCreate.mockRejectedValueOnce(new Error('stripe down'));

        const res = await post(checkoutCompleted);
        expect(res.status).toBe(200);
    });

    // A transport failure must be retried by Stripe: acknowledging would leave
    // a paid order pending forever.
    it('returns 500 when the Convex write throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockConstructEventAsync.mockResolvedValueOnce(checkoutCompleted);
        mockMutation.mockRejectedValueOnce(new Error('convex unreachable'));

        const res = await post(checkoutCompleted);
        expect(res.status).toBe(500);
    });
});
