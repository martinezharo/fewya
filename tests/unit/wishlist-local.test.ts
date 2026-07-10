import { describe, it, expect, beforeEach } from 'vitest';
import {
    getLocalWishlistIds,
    isLocalWishlisted,
    toggleLocalWishlist,
    syncLocalWishlistFromCookie,
} from '../../src/lib/wishlist/wishlist-local';

const STORAGE_KEY = 'fewya_wishlist';
const COOKIE_NAME = 'fewya_wishlist';

function clearCookie() {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function readCookieRaw(): string | null {
    return document.cookie.split('; ').reduce<string | null>((r, v) => {
        const [key, ...rest] = v.split('=');
        return key === COOKIE_NAME ? decodeURIComponent(rest.join('=')) : r;
    }, null);
}

beforeEach(() => {
    localStorage.clear();
    clearCookie();
});

describe('getLocalWishlistIds / isLocalWishlisted', () => {
    it('returns an empty array when nothing is stored', () => {
        expect(getLocalWishlistIds()).toEqual([]);
        expect(isLocalWishlisted('p1')).toBe(false);
    });

    it('reads ids previously written directly to localStorage', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['p1', 'p2']));
        expect(getLocalWishlistIds()).toEqual(['p1', 'p2']);
        expect(isLocalWishlisted('p1')).toBe(true);
        expect(isLocalWishlisted('p3')).toBe(false);
    });

    it('ignores malformed JSON in storage and returns an empty array', () => {
        localStorage.setItem(STORAGE_KEY, '{not json');
        expect(getLocalWishlistIds()).toEqual([]);
    });

    it('ignores a stored value that is not an array', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        expect(getLocalWishlistIds()).toEqual([]);
    });

    it('filters out non-string entries from a stored array', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['p1', 42, null, 'p2']));
        expect(getLocalWishlistIds()).toEqual(['p1', 'p2']);
    });
});

describe('toggleLocalWishlist', () => {
    it('adds a product that is not yet wishlisted and returns true', () => {
        const wished = toggleLocalWishlist('p1');
        expect(wished).toBe(true);
        expect(getLocalWishlistIds()).toEqual(['p1']);
    });

    it('removes a product that is already wishlisted and returns false', () => {
        toggleLocalWishlist('p1');
        const wished = toggleLocalWishlist('p1');
        expect(wished).toBe(false);
        expect(getLocalWishlistIds()).toEqual([]);
    });

    it('keeps other ids untouched when toggling one off', () => {
        toggleLocalWishlist('p1');
        toggleLocalWishlist('p2');
        toggleLocalWishlist('p1');
        expect(getLocalWishlistIds()).toEqual(['p2']);
    });

    it('writes the updated list to the sync cookie as well as localStorage', () => {
        toggleLocalWishlist('p1');
        expect(readCookieRaw()).toBe(JSON.stringify(['p1']));
    });
});

describe('syncLocalWishlistFromCookie', () => {
    it('does nothing when there is no cookie', () => {
        syncLocalWishlistFromCookie();
        expect(getLocalWishlistIds()).toEqual([]);
    });

    it('does nothing when localStorage already has data, even if the cookie differs', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['existing']));
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(['from-cookie']))};path=/`;

        syncLocalWishlistFromCookie();

        expect(getLocalWishlistIds()).toEqual(['existing']);
    });

    it('seeds localStorage from the cookie when storage is empty', () => {
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(['p1', 'p2']))};path=/`;

        syncLocalWishlistFromCookie();

        expect(getLocalWishlistIds()).toEqual(['p1', 'p2']);
    });

    it('filters non-string entries when seeding from the cookie', () => {
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(['p1', 99]))};path=/`;

        syncLocalWishlistFromCookie();

        expect(getLocalWishlistIds()).toEqual(['p1']);
    });

    it('ignores malformed cookie JSON without throwing', () => {
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent('{broken')};path=/`;

        expect(() => syncLocalWishlistFromCookie()).not.toThrow();
        expect(getLocalWishlistIds()).toEqual([]);
    });

    it('ignores a cookie value that parses to a non-array', () => {
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ a: 1 }))};path=/`;

        syncLocalWishlistFromCookie();

        expect(getLocalWishlistIds()).toEqual([]);
    });
});
