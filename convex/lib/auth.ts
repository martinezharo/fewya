import type { MutationCtx, QueryCtx } from '../_generated/server';

export type Identity = {
    subject: string;
    email?: string;
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

    if (!user.email) return null;
    return await ctx.db
        .query('profiles')
        .withIndex('by_email', (q) => q.eq('email', user.email!))
        .unique();
}
