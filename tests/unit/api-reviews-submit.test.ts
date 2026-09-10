import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

const { POST } = await import('../../src/pages/api/reviews/submit');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/reviews/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/reviews/submit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.mutation.mockResolvedValue({ created: 1 });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ productId: 'p1', rating: 5 });
        expect(res.status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON or an invalid payload', async () => {
        expect((await call(undefined, { rawBody: '{' })).status).toBe(400);
        expect((await call({ rating: 5 })).status).toBe(400);
        expect((await call({ productId: 'p1' })).status).toBe(400);
        expect((await call({ productId: 'p1', rating: 0 })).status).toBe(400);
        expect((await call({ productId: 'p1', rating: 6 })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 when the comment exceeds the length limit', async () => {
        const res = await call({ productId: 'p1', rating: 5, comment: 'x'.repeat(2001) });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    // The purchase check lives in the Convex mutation, which refuses to write
    // a review for a product the caller never received in a confirmed order.
    it('returns 403 when the product was not purchased', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Review requires a confirmed purchase'));
        const res = await call({ productId: 'p1', rating: 5 });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: en.apiForbidden });
    });

    it('submits the review as a single-entry batch', async () => {
        const res = await call({ productId: 'p1', rating: 4, comment: '  great  ' });
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            { reviews: [{ productId: 'p1', rating: 4, comment: 'great' }] },
        );
    });

    it('omits an empty comment instead of storing whitespace', async () => {
        await call({ productId: 'p1', rating: 4, comment: '   ' });
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            { reviews: [{ productId: 'p1', rating: 4 }] },
        );
    });
});
