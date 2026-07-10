import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockOrderItemsEq = vi.fn();
const mockReviewsIn = vi.fn();
const mockReviewsInsert = vi.fn();

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: (table: string) => {
            if (table === 'order_items') {
                return { select: () => ({ eq: mockOrderItemsEq }) };
            }
            // reviews
            return {
                select: () => ({ in: mockReviewsIn }),
                insert: mockReviewsInsert,
            };
        },
    }),
}));

const { createAutoReviewsForOrder } = await import('../../src/lib/orders/autoReview');

function orderItemRow(productId: string | undefined, overrides: Record<string, unknown> = {}) {
    return {
        product_variants: productId === undefined ? null : { product_id: productId },
        ...overrides,
    };
}

describe('createAutoReviewsForOrder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockOrderItemsEq.mockResolvedValue({ data: [], error: null });
        mockReviewsIn.mockResolvedValue({ data: [], error: null });
        mockReviewsInsert.mockResolvedValue({ error: null });
    });

    it('does nothing when the order has no items', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: [], error: null });
        await createAutoReviewsForOrder('order-1', en);
        expect(mockReviewsIn).not.toHaveBeenCalled();
        expect(mockReviewsInsert).not.toHaveBeenCalled();
    });

    it('treats a null data payload (no rows, no error) the same as an empty list', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: null, error: null });
        await createAutoReviewsForOrder('order-1', en);
        expect(mockReviewsIn).not.toHaveBeenCalled();
        expect(mockReviewsInsert).not.toHaveBeenCalled();
    });

    it('inserts for all products when the existing-reviews lookup returns a null data payload', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: [orderItemRow('prod-1')], error: null });
        mockReviewsIn.mockResolvedValueOnce({ data: null, error: null });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsInsert).toHaveBeenCalledWith([
            expect.objectContaining({ product_id: 'prod-1' }),
        ]);
    });

    it('does nothing when items resolve to no product ids (missing variant/product)', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [orderItemRow(undefined), { product_variants: {} }],
            error: null,
        });
        await createAutoReviewsForOrder('order-1', en);
        expect(mockReviewsIn).not.toHaveBeenCalled();
        expect(mockReviewsInsert).not.toHaveBeenCalled();
    });

    it('deduplicates repeated product ids across order items', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [orderItemRow('prod-1'), orderItemRow('prod-1'), orderItemRow('prod-2')],
            error: null,
        });
        mockReviewsIn.mockResolvedValueOnce({ data: [], error: null });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsIn).toHaveBeenCalledWith('product_id', ['prod-1', 'prod-2']);
        expect(mockReviewsInsert).toHaveBeenCalledTimes(1);
        const inserted = mockReviewsInsert.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(inserted).toHaveLength(2);
    });

    it('supports product_variants returned as an array (Supabase join shape)', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [{ product_variants: [{ product_id: 'prod-array' }] }],
            error: null,
        });
        mockReviewsIn.mockResolvedValueOnce({ data: [], error: null });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsIn).toHaveBeenCalledWith('product_id', ['prod-array']);
    });

    it('skips products that already have a review', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [orderItemRow('prod-1'), orderItemRow('prod-2')],
            error: null,
        });
        mockReviewsIn.mockResolvedValueOnce({ data: [{ product_id: 'prod-1' }], error: null });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsInsert).toHaveBeenCalledTimes(1);
        const inserted = mockReviewsInsert.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(inserted).toEqual([
            expect.objectContaining({ product_id: 'prod-2' }),
        ]);
    });

    it('does not insert when every product already has a review', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [orderItemRow('prod-1')],
            error: null,
        });
        mockReviewsIn.mockResolvedValueOnce({ data: [{ product_id: 'prod-1' }], error: null });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsInsert).not.toHaveBeenCalled();
    });

    it('inserts a 5-star auto-review with the localized comment for unreviewed products', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({
            data: [orderItemRow('prod-1')],
            error: null,
        });

        await createAutoReviewsForOrder('order-1', en);

        expect(mockReviewsInsert).toHaveBeenCalledWith([
            {
                product_id: 'prod-1',
                profile_id: null,
                rating: 5,
                comment: en.autoReviewComment,
                is_auto: true,
            },
        ]);
    });

    it('swallows errors instead of throwing (best-effort, called post-confirmation)', async () => {
        mockOrderItemsEq.mockRejectedValueOnce(new Error('db exploded'));
        await expect(createAutoReviewsForOrder('order-1', en)).resolves.toBeUndefined();
    });

    it('swallows non-Error thrown values too', async () => {
        mockOrderItemsEq.mockRejectedValueOnce('string failure');
        await expect(createAutoReviewsForOrder('order-1', en)).resolves.toBeUndefined();
    });
});
