import { describe, it, expect, vi } from 'vitest';
import type { AstroCookies } from 'astro';
import {
    getWishlistCount,
    getWishlistIdsFromCookie,
    getMergedWishlistIds,
    getMergedWishlistCount,
} from '../../src/lib/wishlist/wishlist';

function makeCookies(raw?: string): AstroCookies {
    return {
        get: (name: string) => {
            if (name !== 'fewya_wishlist' || raw === undefined) return undefined;
            return { value: raw } as any;
        },
    } as unknown as AstroCookies;
}

function makeCountClient(count: number | null) {
    const eqMock = vi.fn().mockResolvedValue({ count });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    return { from: fromMock, _mocks: { fromMock, selectMock, eqMock } } as any;
}

function makeWishlistDataClient(data: Array<{ product_id: string }> | null) {
    const eqMock = vi.fn().mockResolvedValue({ data });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    return { from: fromMock, _mocks: { fromMock, selectMock, eqMock } } as any;
}

describe('getWishlistCount', () => {
    it('returns the count from the wishlist table for the given user', async () => {
        const client = makeCountClient(3);
        const count = await getWishlistCount(client, 'user-1');
        expect(count).toBe(3);
        expect(client._mocks.fromMock).toHaveBeenCalledWith('wishlist');
        expect(client._mocks.selectMock).toHaveBeenCalledWith('*', { count: 'exact', head: true });
        expect(client._mocks.eqMock).toHaveBeenCalledWith('profile_id', 'user-1');
    });

    it('returns 0 when count is null', async () => {
        const client = makeCountClient(null);
        expect(await getWishlistCount(client, 'user-1')).toBe(0);
    });
});

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
    it('returns only cookie ids for anonymous users (no userId)', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1']));
        const client = makeWishlistDataClient([{ product_id: 'db-1' }]);

        const result = await getMergedWishlistIds(client, makeCookies(raw));

        expect(result).toEqual(new Set(['local-1']));
        expect(client._mocks.fromMock).not.toHaveBeenCalled();
    });

    it('merges DB wishlist ids with local cookie ids for authenticated users', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1', 'shared']));
        const client = makeWishlistDataClient([{ product_id: 'db-1' }, { product_id: 'shared' }]);

        const result = await getMergedWishlistIds(client, makeCookies(raw), 'user-1');

        expect(result).toEqual(new Set(['local-1', 'shared', 'db-1']));
        expect(client._mocks.fromMock).toHaveBeenCalledWith('wishlist');
        expect(client._mocks.eqMock).toHaveBeenCalledWith('profile_id', 'user-1');
    });

    it('handles a null wishData response from the DB gracefully', async () => {
        const client = makeWishlistDataClient(null);
        const result = await getMergedWishlistIds(client, makeCookies(), 'user-1');
        expect(result).toEqual(new Set());
    });

    it('treats userId undefined the same as anonymous', async () => {
        const client = makeWishlistDataClient([{ product_id: 'db-1' }]);
        const result = await getMergedWishlistIds(client, makeCookies(), undefined);
        expect(result).toEqual(new Set());
        expect(client._mocks.fromMock).not.toHaveBeenCalled();
    });
});

describe('getMergedWishlistCount', () => {
    it('returns the size of the merged id set', async () => {
        const raw = encodeURIComponent(JSON.stringify(['local-1', 'local-2']));
        const client = makeWishlistDataClient([{ product_id: 'local-1' }, { product_id: 'db-1' }]);

        const count = await getMergedWishlistCount(client, makeCookies(raw), 'user-1');

        // local-1, local-2, db-1 => 3 unique ids
        expect(count).toBe(3);
    });

    it('returns 0 when there is nothing in cookie or DB', async () => {
        const client = makeWishlistDataClient([]);
        const count = await getMergedWishlistCount(client, makeCookies(), 'user-1');
        expect(count).toBe(0);
    });
});
