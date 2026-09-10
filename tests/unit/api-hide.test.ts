import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

const { POST } = await import('../../src/pages/api/orders/hide');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/hide', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.mutation.mockResolvedValue({ success: true });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing', async () => {
        expect((await call({})).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON', async () => {
        expect((await call(undefined, { rawBody: '{' })).status).toBe(400);
    });

    // Ownership and the pending-only rule are enforced inside the Convex
    // mutation; the route surfaces its refusal instead of hiding the order.
    it('returns 400 when the order does not belong to the caller', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Order not found'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.orderHideNotAllowed });
    });

    it('returns 400 when the order has progressed past pending', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Order cannot be hidden'));
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(400);
    });

    it('hides the order on the happy path', async () => {
        const res = await call({ orderId: 'convex:ORD-1' });
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            { orderId: 'convex:ORD-1' },
        );
    });
});
