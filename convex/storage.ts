import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { identity, profileForIdentity } from './lib/auth';
import { mayAccessStorageObject } from './lib/storageAccess';
import { storageMarker } from './lib/storageMarker';

/** Resolves the caller's profile or refuses; every function here needs one. */
async function callerProfile(ctx: QueryCtx | MutationCtx): Promise<Doc<'profiles'>> {
    const user = await identity(ctx);
    const profile = await profileForIdentity(ctx, user);
    if (!profile) throw new Error('Profile is not linked to this account');
    return profile;
}

/** Generate a one-shot Convex Storage upload URL for an authenticated user. */
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        await callerProfile(ctx);
        return await ctx.storage.generateUploadUrl();
    },
});

/**
 * Records the caller as the owner of a freshly uploaded object and returns its
 * URL.
 *
 * The upload URL hands the storage ID back to the browser, not to Convex, so
 * this is where provenance is written. Claiming is exclusive and first-come:
 * an object already owned by someone else is refused rather than re-assigned,
 * which is what keeps a second caller from adopting a file it did not upload.
 */
export const claimUpload = mutation({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        const profile = await callerProfile(ctx);

        const existing = await ctx.db
            .query('storageUploads')
            .withIndex('by_storage_id', (q) => q.eq('storageId', args.storageId))
            .unique();
        if (existing && existing.ownerId !== profile._id && existing.ownerLegacyId !== profile.legacyId) {
            throw new Error('Storage access denied');
        }
        if (!existing) {
            await ctx.db.insert('storageUploads', {
                storageId: args.storageId,
                ownerId: profile._id,
                ownerLegacyId: profile.legacyId,
                createdAt: Date.now(),
            });
        }

        const url = await ctx.storage.getUrl(args.storageId);
        if (!url) throw new Error('Storage object not found');
        return { url, path: storageMarker(String(args.storageId)) };
    },
});

/**
 * Resolve a Storage document ID to its signed URL.
 *
 * A session is not permission: the store holds shipping labels, which carry
 * the buyer's name and address, and incident photos, which are a dispute's
 * evidence. The caller must be tied to the object by a document — its upload
 * record, their own avatar, their shop's images, or an order they are part of.
 * Public product images are resolved inside the catalog queries instead, which
 * run without a session on purpose.
 */
export const getUrl = query({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        const profile = await callerProfile(ctx);
        if (!await mayAccessStorageObject(ctx, args.storageId, profile)) {
            throw new Error('Storage access denied');
        }
        return await ctx.storage.getUrl(args.storageId);
    },
});

/** Delete a file after the caller has authenticated. Ownership is enforced by
 * the feature-specific mutation (avatar/shop/product/incident) before this
 * helper is called; it is intentionally not exposed as a public API. */
export const deleteSellerFile = mutation({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        const profile = await callerProfile(ctx);
        if (!await mayAccessStorageObject(ctx, args.storageId, profile)) {
            throw new Error('Storage access denied');
        }

        const upload = await ctx.db
            .query('storageUploads')
            .withIndex('by_storage_id', (q) => q.eq('storageId', args.storageId))
            .unique();
        if (upload) await ctx.db.delete(upload._id);

        await ctx.storage.delete(args.storageId);
        return { ok: true };
    },
});
