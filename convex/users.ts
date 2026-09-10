import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { identity, profileByEmail, profileForIdentity } from './lib/auth';
import { mayAdoptProfileByEmail } from './lib/identityLink';
import { isStorageMarker, storageIdFromMarker, storageMarker } from './lib/storageMarker';

/**
 * A profile field the buyer can fill in or clear.
 *
 * `null` is how the forms say "empty this": the checkout address inputs post
 * every field they own, so leaving the floor blank has to be distinguishable
 * from not touching it. The stored column is an optional string, and Convex
 * clears an optional field with `undefined`, so the two are translated at the
 * edge rather than widening the schema to accept nulls it would then have to
 * read back everywhere.
 */
const clearableText = v.optional(v.union(v.string(), v.null()));

/** Trims a submitted value, treating null and an all-space string as cleared. */
function textPatch(value: string | null | undefined): string | undefined {
    if (value == null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Drops the Storage object an avatar field used to point at.
 *
 * A missing object must never fail the profile write that already succeeded:
 * the file may have been removed by an earlier attempt, or never have existed
 * because the field held an imported URL rather than a marker.
 */
async function discardAvatarObject(ctx: MutationCtx, previous: string | undefined): Promise<void> {
    if (!isStorageMarker(previous)) return;
    const storageId = storageIdFromMarker(previous);
    if (!storageId) return;
    try {
        const upload = await ctx.db
            .query('storageUploads')
            .withIndex('by_storage_id', (q) => q.eq('storageId', storageId as Id<'_storage'>))
            .unique();
        if (upload) await ctx.db.delete(upload._id);
        await ctx.storage.delete(storageId as Id<'_storage'>);
    } catch {
        // Already gone, or never a Convex object. The profile is what matters.
    }
}

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
 *
 * Takes no arguments on purpose: everything it writes is derived from the
 * verified Clerk identity. `legacyId` used to be a parameter, which let any
 * authenticated caller bind their Clerk subject to another user's profile UUID
 * (CWE-639). It is generated here, in trusted code, and never accepted.
 */
export const ensureCurrent = mutation({
    args: {},
    handler: async (ctx) => {
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

        // No profile was adopted. If that is only because the address is
        // unverified, creating one here would silently fork an existing
        // account into two, so refuse loudly instead.
        if (user.email && !mayAdoptProfileByEmail(user)) {
            const clash = await profileByEmail(ctx, user.email);
            if (clash) {
                throw new Error(
                    'A profile already exists for this email address. Verify the address with the identity provider before signing in.',
                );
            }
        }

        const email = user.email ?? `clerk-${user.subject}@invalid.local`;
        // Mirrors the Supabase profiles.id UUID column, and is what the
        // compatibility layer authorizes on. Trusted-side only.
        const legacyId = crypto.randomUUID();
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
        firstName: clearableText,
        lastName: clearableText,
        avatarUrl: clearableText,
        phone: clearableText,
        phonePrefix: clearableText,
        addressStreet: clearableText,
        addressNumber: clearableText,
        addressFloor: clearableText,
        addressPostalCode: clearableText,
        addressCity: clearableText,
        addressProvince: clearableText,
        addressCountry: clearableText,
        emailMarketingOptIn: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const patch: Record<string, unknown> = {};
        const textFields = [
            'firstName', 'lastName', 'avatarUrl', 'phone', 'phonePrefix',
            'addressStreet', 'addressNumber', 'addressFloor', 'addressPostalCode',
            'addressCity', 'addressProvince', 'addressCountry',
        ] as const;
        for (const field of textFields) {
            // Only a field the caller actually submitted is touched; `null`
            // and blank submissions clear it, which Convex spells `undefined`.
            if (args[field] !== undefined) patch[field] = textPatch(args[field]);
        }
        if (args.emailMarketingOptIn !== undefined) patch.emailMarketingOptIn = args.emailMarketingOptIn;

        if (Object.keys(patch).length > 0) {
            await ctx.db.patch(profile._id, patch as never);
        }
        return { id: String(profile._id), legacyId: profile.legacyId };
    },
});

/** Attach an uploaded Convex Storage object to the authenticated profile. */
export const setAvatarStorage = mutation({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const previous = profile.avatarUrl;
        const marker = storageMarker(String(args.storageId));
        await ctx.db.patch(profile._id, { avatarUrl: marker });
        await discardAvatarObject(ctx, previous);

        const url = await ctx.storage.getUrl(args.storageId);
        if (!url) throw new Error('Storage object not found');
        return { avatarUrl: marker, url };
    },
});

/** Remove the current profile avatar and its Convex Storage object. */
export const deleteAvatarStorage = mutation({
    args: {},
    handler: async (ctx) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');
        const previous = profile.avatarUrl;
        await ctx.db.patch(profile._id, { avatarUrl: undefined });
        await discardAvatarObject(ctx, previous);
        return { ok: true };
    },
});

/** Mark an authenticated profile as a seller before the first shop exists. */
export const markSeller = mutation({
    args: {},
    handler: async (ctx) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');
        if (!profile.isSeller) await ctx.db.patch(profile._id, { isSeller: true });
        return { ok: true };
    },
});
