import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockPurchasesIn = vi.fn();
const mockExistingReviewsIn = vi.fn();
const mockAutoReviewDelete = vi.fn();
const mockReviewInsert = vi.fn();
const mockReviewUpdate = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: (table: string) => {
            if (table === 'orders') {
                return { select: () => ({ eq: () => ({ eq: () => ({ in: mockPurchasesIn }) }) }) };
            }
            // reviews
            return {
                select: () => ({ eq: () => ({ in: mockExistingReviewsIn }) }),
                delete: () => ({ in: (_column: string, ids: string[]) => ({ eq: () => mockAutoReviewDelete(ids) }) }),
                insert: mockReviewInsert,
                update: (payload: unknown) => ({ eq: (_column: string, id: string) => mockReviewUpdate(id, payload) }),
            };
        },
    }),
}));

const { POST } = await import('../../src/pages/api/reviews/submit-batch');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/reviews/submit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

function purchaseOf(...productIds: string[]) {
    return {
        data: [{
            id: 'order-1',
            order_items: productIds.map((productId) => ({ product_variants: { product_id: productId } })),
        }],
        error: null,
    };
}

describe('POST /api/reviews/submit-batch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1' } } });
        mockPurchasesIn.mockResolvedValue(purchaseOf('prod-1', 'prod-2'));
        mockExistingReviewsIn.mockResolvedValue({ data: [] });
        mockAutoReviewDelete.mockResolvedValue({ error: null });
        mockReviewInsert.mockResolvedValue({ error: null });
        mockReviewUpdate.mockResolvedValue({ error: null });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ reviews: [{ productId: 'prod-1', rating: 5 }] })).status).toBe(401);
    });

    it('returns 400 on malformed JSON or an empty batch', async () => {
        expect((await call(null, { rawBody: '{oops' })).status).toBe(400);
        expect((await call({})).status).toBe(400);
        expect((await call({ reviews: [] })).status).toBe(400);
    });

    it('rejects the whole batch when any entry is invalid', async () => {
        const res = await call({
            reviews: [
                { productId: 'prod-1', rating: 5 },
                { productId: 'prod-2', rating: 7 },
            ],
        });
        expect(res.status).toBe(400);
        expect(mockPurchasesIn).not.toHaveBeenCalled();
    });

    it('rejects the batch when a comment exceeds the length limit', async () => {
        const res = await call({
            reviews: [{ productId: 'prod-1', rating: 5, comment: 'x'.repeat(2001) }],
        });
        expect(res.status).toBe(400);
    });

    it('returns 403 when the purchase check fails', async () => {
        mockPurchasesIn.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        expect((await call({ reviews: [{ productId: 'prod-1', rating: 5 }] })).status).toBe(403);
    });

    it('returns 403 when any product was not purchased in a confirmed order', async () => {
        mockPurchasesIn.mockResolvedValueOnce(purchaseOf('prod-1'));
        const res = await call({
            reviews: [
                { productId: 'prod-1', rating: 5 },
                { productId: 'prod-2', rating: 4 },
            ],
        });
        expect(res.status).toBe(403);
        expect(mockReviewInsert).not.toHaveBeenCalled();
        expect(mockReviewUpdate).not.toHaveBeenCalled();
    });

    it('inserts new reviews and updates existing ones in a single batch', async () => {
        mockExistingReviewsIn.mockResolvedValueOnce({
            data: [{ id: 'rev-2', product_id: 'prod-2' }],
        });
        const res = await call({
            reviews: [
                { productId: 'prod-1', rating: 5, comment: '  Great  ' },
                { productId: 'prod-2', rating: 3 },
            ],
        });
        expect(res.status).toBe(200);
        // Auto-reviews are only cleared for first-time reviews.
        expect(mockAutoReviewDelete).toHaveBeenCalledWith(['prod-1']);
        expect(mockReviewInsert).toHaveBeenCalledWith([
            { product_id: 'prod-1', profile_id: 'buyer-1', rating: 5, comment: 'Great' },
        ]);
        expect(mockReviewUpdate).toHaveBeenCalledWith('rev-2', { rating: 3, comment: null });
        expect(await res.json()).toMatchObject({ success: true });
    });

    it('skips the insert branch entirely when every review already exists', async () => {
        mockExistingReviewsIn.mockResolvedValueOnce({
            data: [{ id: 'rev-1', product_id: 'prod-1' }],
        });
        const res = await call({ reviews: [{ productId: 'prod-1', rating: 4 }] });
        expect(res.status).toBe(200);
        expect(mockAutoReviewDelete).not.toHaveBeenCalled();
        expect(mockReviewInsert).not.toHaveBeenCalled();
    });

    it('returns 500 when the batch insert fails', async () => {
        mockReviewInsert.mockResolvedValueOnce({ error: { message: 'db down' } });
        expect((await call({ reviews: [{ productId: 'prod-1', rating: 5 }] })).status).toBe(500);
    });

    it('returns 500 when a review update fails', async () => {
        mockExistingReviewsIn.mockResolvedValueOnce({
            data: [{ id: 'rev-1', product_id: 'prod-1' }],
        });
        mockReviewUpdate.mockResolvedValueOnce({ error: { message: 'db down' } });
        expect((await call({ reviews: [{ productId: 'prod-1', rating: 5 }] })).status).toBe(500);
    });
});
