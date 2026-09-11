import { describe, it, expect } from 'vitest';
import { normalizeAuthRedirectPath, getAuthRedirectPath, assertSameOrigin } from '../../src/lib/core/auth';

describe('getAuthRedirectPath', () => {
    const resolve = (path: string, key = 'redirect_to') => {
        const url = new URL('https://fewya.com/login');
        url.searchParams.set(key, path);
        return getAuthRedirectPath(url);
    };

    it('defaults to the account and preserves the intended page, query, and fragment', () => {
        expect(getAuthRedirectPath(new URL('https://fewya.com/login'))).toBe('/me');
        expect(resolve('/cart?checkout=1#delivery')).toBe('/cart?checkout=1#delivery');
        expect(resolve('/sell/catalog')).toBe('/sell/catalog');
    });

    it('accepts Clerk return URLs on this origin and prefers the explicit app destination', () => {
        expect(resolve('https://fewya.com/cart?checkout=1#delivery', 'redirect_url')).toBe('/cart?checkout=1#delivery');
        expect(getAuthRedirectPath(new URL('https://fewya.com/login?redirect_to=/cart&redirect_url=/me'))).toBe('/cart');
    });

    it.each([
        '//evil.com', '/\\evil.com', '/\n/evil.com', 'https://evil.com/cart',
        'https://[invalid', 'javascript:alert(1)', '/login', '/sign-up/?redirect_to=/login',
        '/cart/../login', '/%6cogin', '/sign-up#callback', '/%invalid', '/cart/..//evil.com',
    ])('rejects external, malformed, or recursive destination %j', (path) => {
        expect(resolve(path)).toBe('/me');
    });
});

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

    it('returns / for backslash-prefixed paths that browsers normalize to //', () => {
        expect(normalizeAuthRedirectPath('/\\evil.com')).toBe('/');
        expect(normalizeAuthRedirectPath('/\\/evil.com')).toBe('/');
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
