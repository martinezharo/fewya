import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AstroCookies } from 'astro';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

const {
    getWishlistIdsFromCookie,
    getMergedWishlistIds,
    getMergedWishlistCount,
} = await import('../../src/lib/wishlist/wishlist');

function makeCookies(raw?: string): AstroCookies {
    return {
        get: (name: string) => {
            if (name !== 'fewya_wishlist' || raw === undefined) return undefined;
            return { value: raw } as any;
        },
    } as unknown as AstroCookies;
}

const request = new Request('https://fewya.com/');

describe('getWishlistIdsFromCookie', () => {
    it('returns an empty array when there is no cookie', () => {
        expect(getWishlistIdsFromCookie(makeCookies())).toEqual([]);
    });

    it('parses a URI-encoded JSON array cookie value', () => {
        const raw = encodeURIComponent(JSON.stringify(['p1', 'p2']));
        expect(getWishlistIdsFromCookie(makeCookies(raw))).toEqual(['p1', 'p2']);
    });

    it('filters out non-string entries', () => {
        const raw = encodeURIComponent(JSON.stringify(['p1', 5, null]));
        expect(getWishlistIdsFromCookie(makeCookies(raw))).toEqual(['p1']);
    });

    it('returns an empty array for malformed JSON', () => {
        expect(getWishlistIdsFromCookie(makeCookies('{not-json'))).toEqual([]);
    });

    it('returns an empty array when the parsed value is not an array', () => {
        const raw = encodeURIComponent(JSON.stringify({ foo: 'bar' }));
        expect(getWishlistIdsFromCookie(makeCookies(raw))).toEqual([]);
    });
});

describe('getMergedWishlistIds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(['stored-1']);
    });

    it('returns only cookie ids for anonymous visitors', async () => {
        convex.reset(null);
        const raw = encodeURIComponent(JSON.stringify(['local-1']));

        const result = await getMergedWishlistIds(makeCookies(raw), request);

        expect(result).toEqual(new Set(['local-1']));
        expect(convex.query).not.toHaveBeenCalled();
    });

    it('returns only cookie ids when no request is available to authorize with', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1']));
        const result = await getMergedWishlistIds(makeCookies(raw));
        expect(result).toEqual(new Set(['local-1']));
        expect(convex.query).not.toHaveBeenCalled();
    });

    it('merges stored wishlist ids with local cookie ids for signed-in users', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1', 'shared']));
        convex.query.mockResolvedValueOnce(['stored-1', 'shared']);

        const result = await getMergedWishlistIds(makeCookies(raw), request);

        expect(result).toEqual(new Set(['local-1', 'shared', 'stored-1']));
    });

    it('falls back to the cookie ids when the stored wishlist cannot be read', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1']));
        convex.query.mockRejectedValueOnce(new Error('convex down'));

        const result = await getMergedWishlistIds(makeCookies(raw), request);

        expect(result).toEqual(new Set(['local-1']));
    });
});

describe('getMergedWishlistCount', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
    });

    it('returns the size of the merged id set', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1', 'local-2']));
        convex.query.mockResolvedValueOnce(['local-1', 'stored-1']);

        // local-1, local-2, stored-1 => 3 unique ids
        expect(await getMergedWishlistCount(makeCookies(raw), request)).toBe(3);
    });

    it('returns 0 when there is nothing stored and no cookie', async () => {
        convex.query.mockResolvedValueOnce([]);
        expect(await getMergedWishlistCount(makeCookies(), request)).toBe(0);
    });
});
