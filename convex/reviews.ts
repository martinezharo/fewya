import { mutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';

async function productByLegacyId(ctx: MutationCtx, legacyId: string) {
    return await ctx.db
        .query('products')
        .withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId))
        .unique();
}

/**
 * Persists buyer reviews after checking that every product was purchased in a
 * confirmed order belonging to the authenticated profile.
 */
export const submitBatch = mutation({
    args: {
        reviews: v.array(v.object({
            productId: v.string(),
            rating: v.number(),
            comment: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args) => {
        if (args.reviews.length === 0) throw new Error('At least one review is required');

        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const confirmedOrders = await ctx.db
            .query('orders')
            .withIndex('by_buyer_status', (q) => q.eq('buyerId', profile._id).eq('status', 'confirmed'))
            .collect();
        const purchasedProductIds = new Set<string>();

        for (const order of confirmedOrders) {
            const items = await ctx.db
                .query('orderItems')
                .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
                .collect();
            for (const item of items) {
                const variant = item.variantId
                    ? await ctx.db.get(item.variantId)
                    : item.variantLegacyId
                        ? await ctx.db
                            .query('productVariants')
                            .withIndex('by_legacy_id', (q) => q.eq('legacyId', item.variantLegacyId!))
                            .unique()
                        : null;
                if (variant?.productLegacyId) purchasedProductIds.add(variant.productLegacyId);
            }
        }

        for (const review of args.reviews) {
            if (!purchasedProductIds.has(review.productId)) {
                throw new Error('Review requires a confirmed purchase');
            }
        }

        for (const review of args.reviews) {
            const product = await productByLegacyId(ctx, review.productId);
            if (!product) throw new Error('Product not found');

            const existing = await ctx.db
                .query('reviews')
                .withIndex('by_product_id', (q) => q.eq('productId', product._id))
                .filter((q) => q.eq(q.field('profileId'), profile._id))
                .first();

            const comment = review.comment?.trim() || undefined;
            if (existing) {
                await ctx.db.patch(existing._id, {
                    rating: review.rating,
                    comment,
                    isAuto: false,
                });
                continue;
            }

            const autoReviews = await ctx.db
                .query('reviews')
                .withIndex('by_product_id', (q) => q.eq('productId', product._id))
                .filter((q) => q.eq(q.field('isAuto'), true))
                .collect();
            await Promise.all(autoReviews.map((autoReview) => ctx.db.delete(autoReview._id)));

            await ctx.db.insert('reviews', {
                legacyId: `${profile.legacyId}:${product.legacyId}`,
                productId: product._id,
                productLegacyId: product.legacyId,
                profileId: profile._id,
                profileLegacyId: profile.legacyId,
                rating: review.rating,
                comment,
                isAuto: false,
                createdAt: Date.now(),
            });
        }

        return { success: true };
    },
});
