import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

const { POST } = await import('../../src/pages/api/reviews/submit-batch');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/reviews/submit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

describe('POST /api/reviews/submit-batch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.mutation.mockResolvedValue({ created: 2 });
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ reviews: [{ productId: 'p1', rating: 5 }] });
        expect(res.status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON or an empty batch', async () => {
        expect((await call(undefined, { rawBody: '{' })).status).toBe(400);
        expect((await call({ reviews: [] })).status).toBe(400);
        expect((await call({})).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects the whole batch when any entry is invalid', async () => {
        const res = await call({
            reviews: [
                { productId: 'p1', rating: 5 },
                { productId: 'p2', rating: 9 },
            ],
        });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects the batch when a comment exceeds the length limit', async () => {
        const res = await call({
            reviews: [{ productId: 'p1', rating: 5, comment: 'x'.repeat(2001) }],
        });
        expect(res.status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    // Convex verifies every product in the batch was bought by the caller and
    // writes none of them if one was not.
    it('returns 403 when any product was not purchased in a confirmed order', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Review requires a confirmed purchase'));
        const res = await call({
            reviews: [
                { productId: 'p1', rating: 5 },
                { productId: 'p2', rating: 4 },
            ],
        });
        expect(res.status).toBe(403);
    });

    it('forwards the trimmed batch on the happy path', async () => {
        const res = await call({
            reviews: [
                { productId: 'p1', rating: 5, comment: '  solid  ' },
                { productId: 'p2', rating: 4, comment: '   ' },
            ],
        });
        expect(res.status).toBe(200);
        expect(convex.mutation).toHaveBeenCalledWith(
            expect.anything(),
            {
                reviews: [
                    { productId: 'p1', rating: 5, comment: 'solid' },
                    { productId: 'p2', rating: 4, comment: undefined },
                ],
            },
        );
    });
});
