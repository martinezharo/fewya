import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';

export const subscribe = mutation({
    args: {
        endpoint: v.string(),
        p256dh: v.string(),
        auth: v.string(),
        userAgent: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const existing = await ctx.db
            .query('pushSubscriptions')
            .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                userId: profile._id,
                userLegacyId: profile.legacyId,
                p256dh: args.p256dh,
                auth: args.auth,
                ...(args.userAgent === undefined ? {} : { userAgent: args.userAgent }),
            });
            return { subscriptionId: existing.legacyId };
        }

        const legacyId = `convex:push:${crypto.randomUUID()}`;
        await ctx.db.insert('pushSubscriptions', {
            legacyId,
            userId: profile._id,
            userLegacyId: profile.legacyId,
            endpoint: args.endpoint,
            p256dh: args.p256dh,
            auth: args.auth,
            ...(args.userAgent === undefined ? {} : { userAgent: args.userAgent }),
            createdAt: Date.now(),
        });
        return { subscriptionId: legacyId };
    },
});

export const unsubscribe = mutation({
    args: { endpoint: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const existing = await ctx.db
            .query('pushSubscriptions')
            .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
            .unique();
        if (!existing || existing.userLegacyId !== profile.legacyId) return { deleted: false };
        await ctx.db.delete(existing._id);
        return { deleted: true };
    },
});
