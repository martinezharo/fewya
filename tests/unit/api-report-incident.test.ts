import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

const { POST } = await import('../../src/pages/api/orders/report-incident');

const description = 'x'.repeat(60);
const photos = ['a.webp', 'b.webp', 'c.webp'];

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/report-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/orders/report-incident', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.mutation.mockResolvedValue({ success: true, orderId: 'convex:ORD-1' });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ orderId: 'convex:ORD-1', description, photos });
        expect(res.status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
        expect((await call({ description, photos })).status).toBe(400);
        expect((await call({ orderId: 'convex:ORD-1', photos })).status).toBe(400);
        expect((await call({ orderId: 'convex:ORD-1', description })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects a description shorter than 50 non-space characters', async () => {
        const res = await call({ orderId: 'convex:ORD-1', description: 'too short', photos });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.incidentDescriptionError });
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects fewer than 3 or more than 20 photos', async () => {
        expect((await call({ orderId: 'convex:ORD-1', description, photos: ['a.webp'] })).status).toBe(400);
        const tooMany = Array.from({ length: 21 }, (_, i) => `${i}.webp`);
        expect((await call({ orderId: 'convex:ORD-1', description, photos: tooMany })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 when Convex refuses the incident', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Order not found'));
        const res = await call({ orderId: 'convex:ORD-1', description, photos });
        expect(res.status).toBe(400);
    });

    it('records the incident on the happy path', async () => {
        const res = await call({ orderId: 'convex:ORD-1', description, photos });
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            { orderId: 'convex:ORD-1', description, photos },
        );
    });
});
