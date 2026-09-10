import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockSessionRetrieve } = vi.hoisted(() => ({ mockSessionRetrieve: vi.fn() }));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({ checkout: { sessions: { retrieve: mockSessionRetrieve } } }),
}));

const { GET } = await import('../../src/pages/api/cart/checkout/confirm');

const pendingOrder = { id: 'convex:ORD-1', public_id: 'ORD-1', status: 'pending', payment_status: 'pending' };

function call(sessionId?: string) {
    const url = new URL(`https://fewya.com/api/cart/checkout/confirm${sessionId ? `?session_id=${sessionId}` : ''}`);
    return GET({ locals: { t: en, locale: 'en' }, url, request: new Request(url) } as any);
}

describe('GET /api/cart/checkout/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue([pendingOrder]);
        convex.mutation.mockResolvedValue({ success: true, orders: [{ ...pendingOrder, status: 'paid' }] });
        mockSessionRetrieve.mockResolvedValue({ payment_status: 'paid', payment_intent: 'pi_1' });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        expect((await call('cs_1')).status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 without a session id', async () => {
        expect((await call()).status).toBe(400);
    });

    it('returns 404 when the session matches none of the caller´s orders', async () => {
        // The query is scoped to the caller in Convex, so a guessed session id
        // reveals nothing and marks nothing.
        convex.query.mockResolvedValueOnce([]);
        const res = await call('cs_someone_else');
        expect(res.status).toBe(404);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    // The whole point of the route: Stripe, not the returning browser, decides
    // whether the money arrived.
    it('does not mark anything paid while Stripe still reports the session unpaid', async () => {
        mockSessionRetrieve.mockResolvedValueOnce({ payment_status: 'unpaid' });
        const res = await call('cs_1');
        expect(res.status).toBe(409);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('marks the orders paid, passing the deployment secret, once Stripe confirms', async () => {
        const res = await call('cs_1');
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                secret: 'convex-webhook-mock',
                sessionId: 'cs_1',
                paymentIntentId: 'pi_1',
            }),
        );
    });

    it('short-circuits when the orders are already paid', async () => {
        convex.query.mockResolvedValueOnce([{ ...pendingOrder, status: 'paid', payment_status: 'paid' }]);
        const res = await call('cs_1');
        expect(res.status).toBe(200);
        expect(mockSessionRetrieve).not.toHaveBeenCalled();
        expect(convex.mutation).not.toHaveBeenCalled();
    });
});
