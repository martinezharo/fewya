import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — variables whose names start with "mock" are also hoisted
const mockConstructEventAsync = vi.fn();
const mockStripeInstance = {
    webhooks: { constructEventAsync: mockConstructEventAsync },
};
const mockInsert = vi.fn();
const mockRpc = vi.fn();

vi.mock('astro:env/server', () => ({
    APP_MODE: 'production',
    STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_secret_test',
    STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_test_secret',
    STRIPE_SECRET_KEY_TEST: 'sk_test_key_test',
    STRIPE_SECRET_KEY_LIVE: 'sk_test_key',
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
            select: (_cols: string) => ({
                neq: (_col: string, _val: unknown) => ({
                    eq: (_col2: string, _val2: unknown) => Promise.resolve({ data: [] }),
                    in: (_col2: string, _vals: unknown[]) => Promise.resolve({ data: [] }),
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
        // Deduplication: no conflict = new event
        mockInsert.mockResolvedValueOnce({ error: null });

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
        // Unique constraint violation = already processed
        mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });

        const req = new Request('https://fewya.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'valid_sig' },
            body: JSON.stringify(fakeEvent),
        });

        const res = await POST({ request: req } as any);
        expect(res.status).toBe(200);
        expect(mockRpc).not.toHaveBeenCalled();
    });
});
