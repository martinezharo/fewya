import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';

/** Returns the profile linked to the authenticated Clerk subject, if any. */
export const current = query({
    args: {},
    handler: async (ctx) => {
        const user = await identity(ctx);
        return await profileForIdentity(ctx, user);
    },
});

/**
 * Links an existing Supabase profile by verified email on first login, or
 * creates a profile for a genuinely new Clerk user.
 */
export const ensureCurrent = mutation({
    args: { legacyId: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const existing = await profileForIdentity(ctx, user);
        if (existing) {
            if (existing.authSubject !== user.subject) {
                await ctx.db.patch(existing._id, {
                    authSubject: user.subject,
                    ...(user.email && existing.email !== user.email ? { email: user.email } : {}),
                });
            }
            return { id: String(existing._id), legacyId: existing.legacyId, created: false };
        }

        const email = user.email ?? `clerk-${user.subject}@invalid.local`;
        const legacyId = args.legacyId ?? `clerk:${user.subject}`;
        const id = await ctx.db.insert('profiles', {
            legacyId,
            authSubject: user.subject,
            email,
            fullName: user.name,
            firstName: user.givenName,
            lastName: user.familyName,
            avatarUrl: user.pictureUrl,
            isSeller: false,
            emailMarketingOptIn: false,
            createdAt: Date.now(),
        });
        return { id: String(id), legacyId, created: true };
    },
});

/** Update the authenticated profile while preserving the imported field names. */
export const updateCurrent = mutation({
    args: {
        firstName: v.optional(v.union(v.string(), v.null())),
        lastName: v.optional(v.union(v.string(), v.null())),
        avatarUrl: v.optional(v.union(v.string(), v.null())),
        phone: v.optional(v.union(v.string(), v.null())),
        phonePrefix: v.optional(v.union(v.string(), v.null())),
        addressStreet: v.optional(v.union(v.string(), v.null())),
        addressNumber: v.optional(v.union(v.string(), v.null())),
        addressFloor: v.optional(v.union(v.string(), v.null())),
        addressPostalCode: v.optional(v.union(v.string(), v.null())),
        addressCity: v.optional(v.union(v.string(), v.null())),
        addressProvince: v.optional(v.union(v.string(), v.null())),
        addressCountry: v.optional(v.union(v.string(), v.null())),
        emailMarketingOptIn: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const patch: Record<string, unknown> = {};
        if (args.firstName !== undefined) patch.firstName = args.firstName;
        if (args.lastName !== undefined) patch.lastName = args.lastName;
        if (args.avatarUrl !== undefined) patch.avatarUrl = args.avatarUrl;
        if (args.phone !== undefined) patch.phone = args.phone;
        if (args.phonePrefix !== undefined) patch.phonePrefix = args.phonePrefix;
        if (args.addressStreet !== undefined) patch.addressStreet = args.addressStreet;
        if (args.addressNumber !== undefined) patch.addressNumber = args.addressNumber;
        if (args.addressFloor !== undefined) patch.addressFloor = args.addressFloor;
        if (args.addressPostalCode !== undefined) patch.addressPostalCode = args.addressPostalCode;
        if (args.addressCity !== undefined) patch.addressCity = args.addressCity;
        if (args.addressProvince !== undefined) patch.addressProvince = args.addressProvince;
        if (args.addressCountry !== undefined) patch.addressCountry = args.addressCountry;
        if (args.emailMarketingOptIn !== undefined) patch.emailMarketingOptIn = args.emailMarketingOptIn;

        if (Object.keys(patch).length > 0) {
            await ctx.db.patch(profile._id, patch as never);
        }
        return { id: String(profile._id), legacyId: profile.legacyId };
    },
});
