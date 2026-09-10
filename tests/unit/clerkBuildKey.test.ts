import { describe, it, expect } from 'vitest';
import { checkClerkPublishableKey } from '../../src/lib/core/clerkBuildKey';

/**
 * A build without this key deployed to production on 2026-09-10 and took the
 * site down: Clerk's middleware throws before anything else runs, so every
 * request — including the signed-out catalog — answered a redirect to itself.
 * The build must fail instead.
 */
describe('checkClerkPublishableKey', () => {
    it('refuses a build with no key', () => {
        expect(checkClerkPublishableKey(undefined)?.level).toBe('error');
        expect(checkClerkPublishableKey('')?.level).toBe('error');
        expect(checkClerkPublishableKey('   ')?.level).toBe('error');
    });

    it('explains that a Worker secret cannot stand in for it', () => {
        expect(checkClerkPublishableKey(undefined)?.message).toMatch(/Worker secret/i);
    });

    // The development instance builds fine and then fails at the other end:
    // production Convex trusts the production issuer and rejects its tokens.
    it('warns about a development key without failing the build', () => {
        const problem = checkClerkPublishableKey('pk_test_Y2xlcmsuZXhhbXBsZS5jb20k');
        expect(problem?.level).toBe('warning');
        expect(problem?.message).toMatch(/development/i);
    });

    // Worse than an empty value: this build succeeds and serves the key that
    // can act as any user to every visitor of a public site.
    it('refuses a secret key, and says to rotate it', () => {
        const problem = checkClerkPublishableKey('sk_live_ZXhhbXBsZXNlY3JldA');
        expect(problem?.level).toBe('error');
        expect(problem?.message).toMatch(/rotate/i);
    });

    it('refuses anything that is not a publishable key', () => {
        expect(checkClerkPublishableKey('clerk.fewya.com')?.level).toBe('error');
        expect(checkClerkPublishableKey('pk_')?.level).toBe('error');
        expect(checkClerkPublishableKey('true')?.level).toBe('error');
    });

    it('accepts a production key', () => {
        expect(checkClerkPublishableKey('pk_live_Y2xlcmsuZmV3eWEuY29tJA')).toBeNull();
    });
});
