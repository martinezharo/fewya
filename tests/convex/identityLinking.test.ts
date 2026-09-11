/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { api } from '../../convex/_generated/api';
import { newTestHarness, type Harness } from './fixtures';
import { isPlaceholderEmail, realEmail } from '../../convex/lib/placeholderEmail';

/**
 * Linking a Clerk sign-in to an imported profile hands over that person's
 * orders, address and seller permissions. These cover the one rule that keeps
 * that safe: only a provider-verified email may adopt an existing profile.
 */

const IMPORTED_EMAIL = 'imported@fewya.test';

let t: Harness;

beforeEach(async () => {
    t = newTestHarness();
    await t.run(async (ctx) => {
        await ctx.db.insert('profiles', {
            legacyId: '3e2c19e0-19b1-40f3-b3c5-daaa46a15247',
            email: IMPORTED_EMAIL,
            firstName: 'Imported',
            isSeller: true,
            emailMarketingOptIn: false,
            createdAt: 1_700_000_000_000,
        });
    });
});

describe('users.ensureCurrent', () => {
    it('adopts the imported profile for a verified email', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|1', email: IMPORTED_EMAIL, emailVerified: true } as never);
        const linked = await asUser.mutation(api.users.ensureCurrent, {});

        expect(linked.created).toBe(false);
        expect(linked.legacyId).toBe('3e2c19e0-19b1-40f3-b3c5-daaa46a15247');
        // The imported seller keeps their permissions and history.
        const profile = await asUser.query(api.users.current, {});
        expect(profile).toMatchObject({ isSeller: true, firstName: 'Imported', authSubject: 'clerk|1' });
    });

    it('refuses to adopt or fork a profile when the email is unverified', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|2', email: IMPORTED_EMAIL, emailVerified: false } as never);
        await expect(asUser.mutation(api.users.ensureCurrent, {})).rejects.toThrow();

        const profiles = await t.run(async (ctx) => ctx.db.query('profiles').collect());
        expect(profiles).toHaveLength(1);
    });

    it('treats a missing email_verified claim as unverified', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|3', email: IMPORTED_EMAIL } as never);
        await expect(asUser.mutation(api.users.ensureCurrent, {})).rejects.toThrow();
    });

    it('creates a fresh profile for a genuinely new address', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|4', email: 'new@fewya.test', emailVerified: true } as never);
        const linked = await asUser.mutation(api.users.ensureCurrent, {});

        expect(linked.created).toBe(true);
        const profile = await asUser.query(api.users.current, {});
        expect(profile).toMatchObject({ email: 'new@fewya.test', isSeller: false });
    });

    it('is idempotent across sign-ins', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|5', email: 'repeat@fewya.test', emailVerified: true } as never);
        const first = await asUser.mutation(api.users.ensureCurrent, {});
        const second = await asUser.mutation(api.users.ensureCurrent, {});

        expect(second.legacyId).toBe(first.legacyId);
        expect(second.created).toBe(false);
        const profiles = await t.run(async (ctx) => ctx.db.query('profiles').collect());
        expect(profiles).toHaveLength(2);
    });

    it('refuses an anonymous caller', async () => {
        await expect(t.mutation(api.users.ensureCurrent, {})).rejects.toThrow();
    });

    // The subject, not the caller's arguments, decides which profile is
    // written: the mutation takes no id at all.
    it('never lets a caller name the profile to link', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|6', email: 'other@fewya.test', emailVerified: true } as never);
        await expect(
            asUser.mutation(api.users.ensureCurrent, { legacyId: '3e2c19e0-19b1-40f3-b3c5-daaa46a15247' } as never),
        ).rejects.toThrow();
    });
    // Regression: a profile created before the JWT template emitted `email`
    // held an undeliverable stand-in, and nothing ever replaced it. It reached
    // Stripe, the carrier and the seller's order view as the customer's inbox.
    it('stores a stand-in when the provider sends no email, and never sends to it', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|7' } as never);
        await asUser.mutation(api.users.ensureCurrent, {});

        const profile = await asUser.query(api.users.current, {});
        expect(profile?.email).toBe('clerk-clerk|7@invalid.local');
        expect(isPlaceholderEmail(profile!.email)).toBe(true);
        expect(realEmail(profile!.email)).toBeNull();
    });

    it('replaces the stand-in once the provider does send a verified email', async () => {
        const withoutEmail = t.withIdentity({ subject: 'clerk|8' } as never);
        const first = await withoutEmail.mutation(api.users.ensureCurrent, {});

        const withEmail = t.withIdentity({ subject: 'clerk|8', email: 'real@fewya.test', emailVerified: true } as never);
        const second = await withEmail.mutation(api.users.ensureCurrent, {});

        // Same profile, repaired in place: the account keeps its history.
        expect(second.legacyId).toBe(first.legacyId);
        const profile = await withEmail.query(api.users.current, {});
        expect(profile?.email).toBe('real@fewya.test');
    });

    it('keeps the stand-in when the address the provider sends is unverified', async () => {
        const withoutEmail = t.withIdentity({ subject: 'clerk|9' } as never);
        await withoutEmail.mutation(api.users.ensureCurrent, {});

        const unverified = t.withIdentity({ subject: 'clerk|9', email: 'claimed@fewya.test' } as never);
        await unverified.mutation(api.users.ensureCurrent, {});

        const profile = await unverified.query(api.users.current, {});
        expect(isPlaceholderEmail(profile!.email)).toBe(true);
    });

    // `profiles.email` is read through a `.unique()` index, so letting two rows
    // share an address would break the lookup for both accounts.
    it('refuses to reconcile onto an address another profile already holds', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|10' } as never);
        await asUser.mutation(api.users.ensureCurrent, {});

        const squatter = t.withIdentity({ subject: 'clerk|10', email: IMPORTED_EMAIL, emailVerified: true } as never);
        await squatter.mutation(api.users.ensureCurrent, {});

        const profile = await squatter.query(api.users.current, {});
        expect(isPlaceholderEmail(profile!.email)).toBe(true);
        const imported = await t.run(async (ctx) =>
            ctx.db.query('profiles').withIndex('by_email', (q) => q.eq('email', IMPORTED_EMAIL)).unique());
        expect(imported?.legacyId).toBe('3e2c19e0-19b1-40f3-b3c5-daaa46a15247');
    });
    /**
     * Storing an address the provider has not confirmed would send this
     * account's order mail, Stripe receipt and carrier tracking to whoever
     * really owns it, and would reserve that address against the real owner
     * signing up later. Creation therefore holds the same bar as
     * reconciliation: verified, or a stand-in.
     */
    it('stores a stand-in when the email claim on a first sign-in is unverified', async () => {
        const asUser = t.withIdentity({ subject: 'clerk|11', email: 'unproven@fewya.test' } as never);
        const linked = await asUser.mutation(api.users.ensureCurrent, {});

        expect(linked.created).toBe(true);
        const profile = await asUser.query(api.users.current, {});
        expect(isPlaceholderEmail(profile!.email)).toBe(true);
        expect(profile?.email).not.toBe('unproven@fewya.test');
    });

    it('does not reserve an unverified address against its real owner', async () => {
        const squatter = t.withIdentity({ subject: 'clerk|12', email: 'contested@fewya.test' } as never);
        await squatter.mutation(api.users.ensureCurrent, {});

        // The real owner verifies the same address and still gets it.
        const owner = t.withIdentity({ subject: 'clerk|13', email: 'contested@fewya.test', emailVerified: true } as never);
        await owner.mutation(api.users.ensureCurrent, {});

        const profile = await owner.query(api.users.current, {});
        expect(profile?.email).toBe('contested@fewya.test');
    });

    it('repairs the stand-in once that same address is verified', async () => {
        const unverified = t.withIdentity({ subject: 'clerk|14', email: 'later@fewya.test' } as never);
        const first = await unverified.mutation(api.users.ensureCurrent, {});

        const verified = t.withIdentity({ subject: 'clerk|14', email: 'later@fewya.test', emailVerified: true } as never);
        const second = await verified.mutation(api.users.ensureCurrent, {});

        expect(second.legacyId).toBe(first.legacyId);
        const profile = await verified.query(api.users.current, {});
        expect(profile?.email).toBe('later@fewya.test');
    });
});
