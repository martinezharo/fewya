import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { v } from 'convex/values';

async function currentProfile(ctx: QueryCtx) {
    const user = await ctx.auth.getUserIdentity();
    if (!user?.subject) throw new Error('Authentication required');
    const bySubject = await ctx.db
        .query('profiles')
        .withIndex('by_auth_subject', (q) => q.eq('authSubject', user.subject))
        .unique();
    if (bySubject) return bySubject;
    if (!user.email) throw new Error('Profile is not linked to this account');
    const byEmail = await ctx.db
        .query('profiles')
        .withIndex('by_email', (q) => q.eq('email', user.email!))
        .unique();
    if (!byEmail) throw new Error('Profile is not linked to this account');
    return byEmail;
}

export const mine = query({
    args: {},
    handler: async (ctx) => {
        const profile = await currentProfile(ctx);
        const rows = await ctx.db
            .query('wishlist')
            .withIndex('by_profile_id', (q) => q.eq('profileId', profile._id))
            .collect();
        return rows.map((row) => row.productLegacyId);
    },
});

export const toggle = mutation({
    args: { productLegacyId: v.string() },
    handler: async (ctx, args) => {
        const profile = await currentProfile(ctx);
        const product = await ctx.db
            .query('products')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.productLegacyId))
            .unique();
        if (!product) throw new Error('Product not found');

        const existing = await ctx.db
            .query('wishlist')
            .withIndex('by_profile_id', (q) => q.eq('profileId', profile._id))
            .filter((q) => q.eq(q.field('productId'), product._id))
            .unique();
        if (existing) {
            await ctx.db.delete(existing._id);
            return { wished: false };
        }

        await ctx.db.insert('wishlist', {
            legacyId: `${profile.legacyId}:${product.legacyId}`,
            profileId: profile._id,
            profileLegacyId: profile.legacyId,
            productId: product._id,
            productLegacyId: product.legacyId,
            createdAt: Date.now(),
        });
        return { wished: true };
    },
});
