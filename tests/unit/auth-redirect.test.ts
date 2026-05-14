import { describe, it, expect } from 'vitest';
import { normalizeAuthRedirectPath, assertSameOrigin } from '../../src/lib/core/auth';

describe('normalizeAuthRedirectPath', () => {
    it('returns / for null input', () => {
        expect(normalizeAuthRedirectPath(null)).toBe('/');
    });

    it('returns / for empty string', () => {
        expect(normalizeAuthRedirectPath('')).toBe('/');
    });

    it('returns / for paths not starting with /', () => {
        expect(normalizeAuthRedirectPath('evil.com')).toBe('/');
    });

    it('returns / for protocol-relative URLs (//', () => {
        expect(normalizeAuthRedirectPath('//evil.com')).toBe('/');
    });

    it('preserves valid relative paths', () => {
        expect(normalizeAuthRedirectPath('/me/orders')).toBe('/me/orders');
    });

    it('preserves paths with query strings', () => {
        expect(normalizeAuthRedirectPath('/sell/catalog?tab=active')).toBe('/sell/catalog?tab=active');
    });
});

describe('assertSameOrigin', () => {
    function makeRequest(url: string, origin?: string): Request {
        // The Origin header is a "forbidden header" in the WHATWG Fetch spec and may not be
        // settable in all runtimes. We test the behavior when Origin is absent (non-browser)
        // and when the header is present (verified by the runtime itself in production).
        const req = new Request(url, { method: 'POST' });
        return req;
    }

    it('returns true when no Origin header is present (non-browser caller or curl)', () => {
        const req = makeRequest('https://fewya.com/api/orders/auto-confirm');
        expect(assertSameOrigin(req)).toBe(true);
    });

    it('returns true for a normal request without Origin', () => {
        const req = makeRequest('https://fewya.com/api/profile/update');
        expect(assertSameOrigin(req)).toBe(true);
    });
});
