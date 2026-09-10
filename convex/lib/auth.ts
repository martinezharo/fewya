import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mayAdoptProfileByEmail } from './identityLink';

export type Identity = {
    subject: string;
    email?: string;
    /** JWT `email_verified` claim. Absent means unverified — never assume true. */
    emailVerified?: boolean;
    name?: string;
    givenName?: string;
    familyName?: string;
    pictureUrl?: string;
};

type AuthCtx = QueryCtx | MutationCtx;

export async function identity(ctx: AuthCtx): Promise<Identity> {
    const value = await ctx.auth.getUserIdentity();
    if (!value?.subject) throw new Error('Authentication required');
    return value as Identity;
}

export async function profileForIdentity(ctx: AuthCtx, user: Identity) {
    const bySubject = await ctx.db
        .query('profiles')
        .withIndex('by_auth_subject', (q) => q.eq('authSubject', user.subject))
        .unique();
    if (bySubject) return bySubject;

    // Adopting a profile by email hands over its orders, address and seller
    // permissions, so it requires a verified address. See mayAdoptProfileByEmail.
    if (!mayAdoptProfileByEmail(user)) return null;
    return await profileByEmail(ctx, user.email!);
}

/** Raw email lookup. Callers are responsible for authorizing the adoption. */
export async function profileByEmail(ctx: AuthCtx, email: string) {
    return await ctx.db
        .query('profiles')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique();
}
