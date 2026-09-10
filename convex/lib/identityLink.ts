/**
 * Rules that decide whether an authenticated identity may adopt an existing
 * profile. Kept free of Convex imports so the security decision can be unit
 * tested on its own, without a Convex runtime.
 */

export type LinkableIdentity = {
    subject: string;
    email?: string;
    emailVerified?: boolean;
};

/**
 * Whether a profile may be looked up — and adopted — by this identity's email.
 *
 * Adoption by email is how the staged Supabase→Convex cutover links an existing
 * account on first Clerk login, so it hands over that profile's orders, address
 * and seller permissions. That is only safe when the identity provider asserts
 * the address really belongs to the caller: without the `email_verified` claim,
 * anyone could sign up with someone else's address and inherit their account.
 *
 * A missing claim counts as unverified. Fail closed, never open.
 */
export function mayAdoptProfileByEmail(user: LinkableIdentity): boolean {
    return typeof user.email === 'string' && user.email.trim().length > 0 && user.emailVerified === true;
}
