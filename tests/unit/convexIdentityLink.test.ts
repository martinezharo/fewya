import { describe, it, expect } from 'vitest';
import { mayAdoptProfileByEmail } from '../../convex/lib/identityLink';

describe('mayAdoptProfileByEmail', () => {
    it('allows adoption only for a verified address', () => {
        expect(mayAdoptProfileByEmail({ subject: 'clerk_1', email: 'a@b.com', emailVerified: true })).toBe(true);
    });

    // An unverified address is an attacker-controlled string: signing up with
    // someone else's email must never inherit their profile.
    it('refuses an unverified address', () => {
        expect(mayAdoptProfileByEmail({ subject: 'clerk_1', email: 'victim@fewya.com', emailVerified: false })).toBe(false);
    });

    it('treats a missing email_verified claim as unverified', () => {
        expect(mayAdoptProfileByEmail({ subject: 'clerk_1', email: 'victim@fewya.com' })).toBe(false);
    });

    it('refuses a missing or blank address', () => {
        expect(mayAdoptProfileByEmail({ subject: 'clerk_1', emailVerified: true })).toBe(false);
        expect(mayAdoptProfileByEmail({ subject: 'clerk_1', email: '   ', emailVerified: true })).toBe(false);
    });

    it('does not accept a truthy non-boolean claim', () => {
        const forged = { subject: 'clerk_1', email: 'victim@fewya.com', emailVerified: 'true' } as unknown as Parameters<typeof mayAdoptProfileByEmail>[0];
        expect(mayAdoptProfileByEmail(forged)).toBe(false);
    });
});

describe('users.ensureCurrent argument contract', () => {
    /**
     * Regression guard for CWE-639: `legacyId` used to be a mutation argument.
     * It becomes `User.id` in the middleware, and the compatibility layer
     * queries Supabase with a service-role key scoped by that id, so any
     * authenticated caller could bind their Clerk subject to another user's
     * profile UUID by calling the mutation directly. It must stay server-side.
     */
    it('accepts no caller-supplied arguments at all', async () => {
        const { ensureCurrent } = await import('../../convex/users');
        const validator = (ensureCurrent as unknown as { exportArgs: () => string }).exportArgs();
        const parsed = JSON.parse(validator) as { type: string; value: Record<string, unknown> };

        expect(parsed.value).not.toHaveProperty('legacyId');
        expect(Object.keys(parsed.value)).toEqual([]);
    });
});
