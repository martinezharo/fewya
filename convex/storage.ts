import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';

const storageMarker = (storageId: string) => `convex-storage:${storageId}`;

/** Generate a one-shot Convex Storage upload URL for an authenticated user. */
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        await identity(ctx);
        return await ctx.storage.generateUploadUrl();
    },
});

/** Resolve a Storage document ID to its signed/public URL. */
export const getUrl = query({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        return await ctx.storage.getUrl(args.storageId);
    },
});

/** Resolve an imported Supabase Storage URL to its migrated Convex object. */
export const resolveLegacyUrl = query({
    args: { url: v.string() },
    handler: async (ctx, args) => {
        try {
            const parsed = new URL(args.url);
            const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
            if (!match) return null;
            const bucket = decodeURIComponent(match[1]);
            const legacyPath = decodeURIComponent(match[2]);
            const object = await ctx.db
                .query('storageObjects')
                .withIndex('by_bucket_path', (q) => q.eq('bucket', bucket).eq('legacyPath', legacyPath))
                .unique();
            if (!object?.storageId) return null;
            return await ctx.storage.getUrl(object.storageId);
        } catch {
            return null;
        }
    },
});

/** Delete a file after the caller has authenticated. Ownership is enforced by
 * the feature-specific mutation (avatar/shop/product/incident) before this
 * helper is called; it is intentionally not exposed as a public API. */
export const deleteSellerFile = mutation({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const shops = [
            ...(await ctx.db.query('shops').withIndex('by_owner_id', (q) => q.eq('ownerId', profile._id)).collect()),
            ...(await ctx.db.query('shops').withIndex('by_owner_legacy_id', (q) => q.eq('ownerLegacyId', profile.legacyId)).collect()),
        ];
        const uniqueShops = [...new Map(shops.map((shop) => [String(shop._id), shop])).values()];
        const marker = storageMarker(String(args.storageId));
        let referenced = false;

        for (const shop of uniqueShops) {
            if (shop.profileImg === marker || shop.bannerImg === marker) {
                referenced = true;
                break;
            }

            const products = [
                ...(await ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect()),
                ...(await ctx.db.query('products').withIndex('by_shop_legacy_id', (q) => q.eq('shopLegacyId', shop.legacyId)).collect()),
            ];
            const uniqueProducts = [...new Map(products.map((product) => [String(product._id), product])).values()];
            for (const product of uniqueProducts) {
                if (product.galleryImages.includes(marker)) {
                    referenced = true;
                    break;
                }

                const variants = [
                    ...(await ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect()),
                    ...(await ctx.db.query('productVariants').withIndex('by_product_legacy_id', (q) => q.eq('productLegacyId', product.legacyId)).collect()),
                ];
                if (variants.some((variant) => variant.variantImage === marker)) {
                    referenced = true;
                    break;
                }
            }
            if (referenced) break;
        }

        if (!referenced) throw new Error('Storage access denied');
        await ctx.storage.delete(args.storageId);
        return { ok: true };
    },
});
