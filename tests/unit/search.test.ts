import { describe, it, expect } from 'vitest';
import {
    parseSearchParams,
    buildSearchUrl,
    DEFAULT_SORT,
    DEFAULT_DIR,
    RECENT_SEARCHES_KEY,
    MAX_RECENT_SEARCHES,
} from '../../src/lib/products/search';

describe('parseSearchParams', () => {
    it('returns defaults for an empty URL', () => {
        const result = parseSearchParams(new URL('http://localhost/search'));
        expect(result).toEqual({
            q: '',
            minPrice: null,
            maxPrice: null,
            showOos: false,
            sort: DEFAULT_SORT,
            dir: DEFAULT_DIR,
        });
    });

    it('parses q, prices, showOos, sort and dir from the query string', () => {
        const url = new URL(
            'http://localhost/search?q=zapatos&min_price=10&max_price=50&show_oos=true&sort=price&dir=asc',
        );
        const result = parseSearchParams(url);
        expect(result).toEqual({
            q: 'zapatos',
            minPrice: 10,
            maxPrice: 50,
            showOos: true,
            sort: 'price',
            dir: 'asc',
        });
    });

    it('ignores non-numeric min/max price and leaves them null', () => {
        const url = new URL('http://localhost/search?min_price=abc&max_price=xyz');
        const result = parseSearchParams(url);
        expect(result.minPrice).toBeNull();
        expect(result.maxPrice).toBeNull();
    });

    it('treats any non-"true" show_oos value as false', () => {
        expect(parseSearchParams(new URL('http://localhost/search?show_oos=1')).showOos).toBe(false);
        expect(parseSearchParams(new URL('http://localhost/search?show_oos=false')).showOos).toBe(false);
    });

    it('falls back to default sort/dir for invalid values', () => {
        const url = new URL('http://localhost/search?sort=bogus&dir=sideways');
        const result = parseSearchParams(url);
        expect(result.sort).toBe(DEFAULT_SORT);
        expect(result.dir).toBe(DEFAULT_DIR);
    });

    it('accepts every valid sort option and direction', () => {
        for (const sort of ['relevance', 'alpha', 'price', 'date']) {
            expect(parseSearchParams(new URL(`http://localhost/search?sort=${sort}`)).sort).toBe(sort);
        }
        for (const dir of ['asc', 'desc']) {
            expect(parseSearchParams(new URL(`http://localhost/search?dir=${dir}`)).dir).toBe(dir);
        }
    });

    it('accepts a zero min/max price (not treated as missing)', () => {
        const url = new URL('http://localhost/search?min_price=0&max_price=0');
        const result = parseSearchParams(url);
        expect(result.minPrice).toBe(0);
        expect(result.maxPrice).toBe(0);
    });
});

describe('buildSearchUrl', () => {
    it('builds a bare path when no params are set', () => {
        expect(buildSearchUrl('/search', {})).toBe('/search');
    });

    it('sets q when provided and non-empty', () => {
        expect(buildSearchUrl('/search', { q: 'silla' })).toBe('/search?q=silla');
    });

    it('deletes q when explicitly set to an empty string', () => {
        const withQ = buildSearchUrl('/search?q=old', { q: '' });
        expect(withQ).toBe('/search');
    });

    it('sets and deletes min/max price', () => {
        expect(buildSearchUrl('/search', { minPrice: 5, maxPrice: 20 })).toBe(
            '/search?min_price=5&max_price=20',
        );
        expect(buildSearchUrl('/search?min_price=5', { minPrice: null })).toBe('/search');
    });

    it('sets show_oos=true only when true, deletes otherwise', () => {
        expect(buildSearchUrl('/search', { showOos: true })).toBe('/search?show_oos=true');
        expect(buildSearchUrl('/search?show_oos=true', { showOos: false })).toBe('/search');
    });

    it('only sets sort/dir when they differ from the default', () => {
        expect(buildSearchUrl('/search', { sort: DEFAULT_SORT })).toBe('/search');
        expect(buildSearchUrl('/search', { sort: 'alpha' })).toBe('/search?sort=alpha');
        expect(buildSearchUrl('/search', { dir: DEFAULT_DIR })).toBe('/search');
        expect(buildSearchUrl('/search', { dir: 'asc' })).toBe('/search?dir=asc');
    });

    it('removes a previously set sort when reverted to default', () => {
        expect(buildSearchUrl('/search?sort=alpha', { sort: DEFAULT_SORT })).toBe('/search');
    });

    it('combines multiple params, preserving URLSearchParams ordering', () => {
        const result = buildSearchUrl('/search', {
            q: 'mesa',
            minPrice: 10,
            maxPrice: 100,
            showOos: true,
            sort: 'date',
            dir: 'asc',
        });
        expect(result).toBe('/search?q=mesa&min_price=10&max_price=100&show_oos=true&sort=date&dir=asc');
    });

    it('leaves unrelated existing params untouched when only updating one field', () => {
        const result = buildSearchUrl('/search?q=existing&sort=alpha', { minPrice: 3 });
        expect(result).toContain('q=existing');
        expect(result).toContain('sort=alpha');
        expect(result).toContain('min_price=3');
    });
});

describe('constants', () => {
    it('exposes stable default values', () => {
        expect(DEFAULT_SORT).toBe('relevance');
        expect(DEFAULT_DIR).toBe('desc');
        expect(RECENT_SEARCHES_KEY).toBe('fewya-recent-searches');
        expect(MAX_RECENT_SEARCHES).toBe(5);
    });
});
