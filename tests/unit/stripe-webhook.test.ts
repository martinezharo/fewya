import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — variables whose names start with "mock" are also hoisted
const mockConstructEventAsync = vi.fn();
const mockRefundsCreate = vi.fn();
const mockStripeInstance = {
    webhooks: { constructEventAsync: mockConstructEventAsync },
    refunds: { create: mockRefundsCreate },
};
const mockInsert = vi.fn();
const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();
const mockOrdersSelectResult = vi.fn();
const mockOrdersUpdateIn = vi.fn();

vi.mock('astro:env/server', () => ({
    APP_MODE: 'production',
    STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_secret_test',
    STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_test_secret',
    STRIPE_SECRET_KEY_TEST: 'sk_test_key_test',
    STRIPE_SECRET_KEY_LIVE: 'sk_test_key',
    CONVEX_WEBHOOK_SECRET: undefined,
    CONVEX_ONLY: 'false',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
    SUPABASE_SECRET_KEY: 'test-secret-key',
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => mockStripeInstance,
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: (_table: string) => ({
            insert: mockInsert,
            update: (_values: Record<string, unknown>) => ({ in: mockOrdersUpdateIn }),
            select: (_cols: string) => ({
                // dedup pre-check: .select('event_id').eq('event_id', id).maybeSingle()
                eq: (_col: string, _val: unknown) => ({
                    maybeSingle: mockMaybeSingle,
                }),
                // orders lookup: .select(...).neq(...).eq(...)/.in(...)
                neq: (_col: string, _val: unknown) => ({
                    eq: (_col2: string, _val2: unknown) => mockOrdersSelectResult(),
                    in: (_col2: string, _vals: unknown[]) => mockOrdersSelectResult(),
                }),
            }),
        }),
        rpc: mockRpc,
    }),
}));

vi.mock('../../src/lib/core/security-log', () => ({
    securityLog: vi.fn(),
}));

const { POST } = await import('../../src/pages/api/webhooks/stripe');

describe('Stripe webhook handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockOrdersSelectResult.mockResolvedValue({ data: [] });
        mockOrdersUpdateIn.mockResolvedValue({ error: null });
    });

    it('returns 400 when stripe-signature header is missing', async () => {
        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            body: '{}',
        });

        const res = await POST({ request: req } as any);
        expect(res.status).toBe(400);
    });

    it('returns 401 when signature is invalid', async () => {
        mockConstructEventAsync.mockRejectedValueOnce(new Error('No signatures found'));

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'bad_sig', 'Content-Type': 'text/plain' },
            body: '{}',
        });

        const res = await POST({ request: req } as any);
        expect(res.status).toBe(401);
    });

    it('returns 200 for a valid event when signature passes', async () => {
        const fakeEvent = {
            id: 'evt_test_ok',
            type: 'charge.refunded',
            data: { object: { id: 'ch_1', amount_refunded: 1000 } },
        };
        mockConstructEventAsync.mockResolvedValueOnce(fakeEvent);
        // Dedup pre-check: not previously processed
        mockMaybeSingle.mockResolvedValueOnce({ data: null });

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'valid_sig' },
            body: JSON.stringify(fakeEvent),
        });

        const res = await POST({ request: req } as any);
        expect(res.status).toBe(200);
    });

    it('returns 200 without re-processing a duplicate event (idempotency)', async () => {
        const fakeEvent = {
            id: 'evt_duplicate',
            type: 'charge.refunded',
            data: { object: { id: 'ch_dup', amount_refunded: 500 } },
        };
        mockConstructEventAsync.mockResolvedValueOnce(fakeEvent);
        // Dedup pre-check: event already recorded
        mockMaybeSingle.mockResolvedValueOnce({ data: { event_id: 'evt_duplicate' } });

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'valid_sig' },
            body: JSON.stringify(fakeEvent),
        });

        const res = await POST({ request: req } as any);
        expect(res.status).toBe(200);
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('refunds the charge and cancels the order when mark_order_paid fails (e.g. insufficient stock)', async () => {
        const fakeEvent = {
            id: 'evt_stock_conflict',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_1',
                    payment_intent: 'pi_1',
                },
            },
        };
        mockConstructEventAsync.mockResolvedValueOnce(fakeEvent);
        mockMaybeSingle.mockResolvedValueOnce({ data: null });
        mockOrdersSelectResult.mockResolvedValueOnce({
            data: [{ id: 'order-1', buyer_id: 'buyer-1', stripe_checkout_session_id: 'cs_1' }],
        });
        mockRpc.mockResolvedValueOnce({ error: { message: 'insufficient_stock' } });
        mockRefundsCreate.mockResolvedValueOnce({ id: 're_1' });

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'valid_sig' },
            body: JSON.stringify(fakeEvent),
        });

        const res = await POST({ request: req } as any);

        expect(res.status).toBe(200);
        expect(mockRefundsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ payment_intent: 'pi_1' }),
            expect.objectContaining({ idempotencyKey: 'mark-paid-failure-refund:cs_1' }),
        );
        expect(mockOrdersUpdateIn).toHaveBeenCalledWith('id', ['order-1']);
        // The event is still recorded so Stripe doesn't retry forever once we've
        // already refunded and cancelled — retrying would just refund again.
        expect(mockInsert).toHaveBeenCalledWith({ event_id: 'evt_stock_conflict', source: 'stripe' });
    });

    it('still cancels the order when the compensating Stripe refund itself fails', async () => {
        const fakeEvent = {
            id: 'evt_stock_conflict_2',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_2',
                    payment_intent: 'pi_2',
                },
            },
        };
        mockConstructEventAsync.mockResolvedValueOnce(fakeEvent);
        mockMaybeSingle.mockResolvedValueOnce({ data: null });
        mockOrdersSelectResult.mockResolvedValueOnce({
            data: [{ id: 'order-2', buyer_id: 'buyer-2', stripe_checkout_session_id: 'cs_2' }],
        });
        mockRpc.mockResolvedValueOnce({ error: { message: 'insufficient_stock' } });
        mockRefundsCreate.mockRejectedValueOnce(new Error('stripe down'));

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'valid_sig' },
            body: JSON.stringify(fakeEvent),
        });

        const res = await POST({ request: req } as any);

        expect(res.status).toBe(200);
        expect(mockOrdersUpdateIn).toHaveBeenCalledWith('id', ['order-2']);
    });
});
