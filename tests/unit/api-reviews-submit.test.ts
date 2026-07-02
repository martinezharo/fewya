import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockExistingReviewMaybeSingle = vi.fn();
const mockReviewInsert = vi.fn();
const mockReviewUpdate = vi.fn();
const mockReviewMutationSingle = vi.fn();
const mockAutoReviewDelete = vi.fn();

// The route runs two sequential queries against `orders`; results are
// consumed from this queue in order (purchase check, then product match).
let ordersResults: unknown[] = [];

function ordersChain() {
    const resolveNext = () => Promise.resolve(ordersResults.shift());
    const terminal = {
        then: (onFulfilled: any, onRejected: any) => resolveNext().then(onFulfilled, onRejected),
        maybeSingle: () => resolveNext(),
    };
    const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: () => terminal,
    };
    return chain;
}

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: (table: string) => {
            if (table === 'orders') {
                return ordersChain();
            }
            // reviews
            return {
                select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: mockExistingReviewMaybeSingle }) }) }) }),
                insert: (payload: unknown) => {
                    mockReviewInsert(payload);
                    return { select: () => ({ single: mockReviewMutationSingle }) };
                },
                update: (payload: unknown) => {
                    mockReviewUpdate(payload);
                    return { eq: () => ({ select: () => ({ single: mockReviewMutationSingle }) }) };
                },
                delete: () => ({ eq: () => ({ eq: mockAutoReviewDelete }) }),
            };
        },
    }),
}));

const { POST } = await import('../../src/pages/api/reviews/submit');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/reviews/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

describe('POST /api/reviews/submit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1' } } });
        ordersResults = [
            { data: [{ id: 'order-1' }], error: null },
            { data: { id: 'order-1' }, error: null },
        ];
        mockExistingReviewMaybeSingle.mockResolvedValue({ data: null });
        mockAutoReviewDelete.mockResolvedValue({ error: null });
        mockReviewMutationSingle.mockResolvedValue({
            data: { id: 'rev-1', product_id: 'prod-1', rating: 5 },
            error: null,
        });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        expect((await call({ productId: 'prod-1', rating: 5 })).status).toBe(401);
    });

    it('returns 400 on malformed JSON or an invalid payload', async () => {
        expect((await call(null, { rawBody: '{oops' })).status).toBe(400);
        expect((await call({ rating: 5 })).status).toBe(400);
        expect((await call({ productId: 'prod-1', rating: 0 })).status).toBe(400);
        expect((await call({ productId: 'prod-1', rating: 6 })).status).toBe(400);
        expect((await call({ productId: 'prod-1', rating: 'five' })).status).toBe(400);
    });

    it('returns 400 when the comment exceeds the length limit', async () => {
        const res = await call({ productId: 'prod-1', rating: 5, comment: 'x'.repeat(2001) });
        expect(res.status).toBe(400);
    });

    it('returns 403 when the buyer has no confirmed orders', async () => {
        ordersResults = [{ data: [], error: null }];
        const res = await call({ productId: 'prod-1', rating: 5 });
        expect(res.status).toBe(403);
        expect(mockReviewInsert).not.toHaveBeenCalled();
    });

    it('returns 403 when no confirmed order contains the product', async () => {
        ordersResults = [
            { data: [{ id: 'order-1' }], error: null },
            { data: null, error: null },
        ];
        const res = await call({ productId: 'prod-1', rating: 5 });
        expect(res.status).toBe(403);
        expect(mockReviewInsert).not.toHaveBeenCalled();
    });

    it('updates the existing review instead of inserting a duplicate', async () => {
        mockExistingReviewMaybeSingle.mockResolvedValueOnce({ data: { id: 'rev-1' } });
        const res = await call({ productId: 'prod-1', rating: 4, comment: 'Better now' });
        expect(res.status).toBe(200);
        expect(mockReviewUpdate).toHaveBeenCalledWith({ rating: 4, comment: 'Better now' });
        expect(mockReviewInsert).not.toHaveBeenCalled();
        expect(mockAutoReviewDelete).not.toHaveBeenCalled();
    });

    it('removes the auto-review and inserts the real one on first submission', async () => {
        const res = await call({ productId: 'prod-1', rating: 5, comment: 'Great' });
        expect(res.status).toBe(200);
        expect(mockAutoReviewDelete).toHaveBeenCalledTimes(1);
        expect(mockReviewInsert).toHaveBeenCalledWith({
            product_id: 'prod-1',
            profile_id: 'buyer-1',
            rating: 5,
            comment: 'Great',
        });
        expect(await res.json()).toMatchObject({ success: true });
    });

    it('returns 500 when persisting the review fails', async () => {
        mockReviewMutationSingle.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        expect((await call({ productId: 'prod-1', rating: 5 })).status).toBe(500);
    });
});
