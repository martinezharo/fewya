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

    it('accepts a production key', () => {
        expect(checkClerkPublishableKey('pk_live_Y2xlcmsuZmV3eWEuY29tJA')).toBeNull();
    });
});
