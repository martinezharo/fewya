export interface SearchParams {
    q: string;
    minPrice: number | null;
    maxPrice: number | null;
    showOos: boolean;
    sort: SortOption;
    dir: SortDirection;
}

export type SortOption = 'relevance' | 'alpha' | 'price' | 'date';
export type SortDirection = 'asc' | 'desc';

export const DEFAULT_SORT: SortOption = 'relevance';
export const DEFAULT_DIR: SortDirection = 'desc';
export const RECENT_SEARCHES_KEY = 'shopenn-recent-searches';
export const MAX_RECENT_SEARCHES = 5;

export function parseSearchParams(url: URL): SearchParams {
    const q = url.searchParams.get('q') || '';
    
    let minPrice: number | null = null;
    if (url.searchParams.has('min_price')) {
        const val = Number(url.searchParams.get('min_price'));
        if (!isNaN(val)) minPrice = val;
    }
    
    let maxPrice: number | null = null;
    if (url.searchParams.has('max_price')) {
        const val = Number(url.searchParams.get('max_price'));
        if (!isNaN(val)) maxPrice = val;
    }
    
    const showOos = url.searchParams.get('show_oos') === 'true';
    
    let sort = (url.searchParams.get('sort') as SortOption) || DEFAULT_SORT;
    if (!['relevance', 'alpha', 'price', 'date'].includes(sort)) sort = DEFAULT_SORT;
    
    let dir = (url.searchParams.get('dir') as SortDirection) || DEFAULT_DIR;
    if (!['asc', 'desc'].includes(dir)) dir = DEFAULT_DIR;

    return { q, minPrice, maxPrice, showOos, sort, dir };
}

export function buildSearchUrl(baseUrl: string, params: Partial<SearchParams>): string {
    // Only safe for client side or when base is valid
    const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    
    if (params.q !== undefined) {
        if (params.q) url.searchParams.set('q', params.q);
        else url.searchParams.delete('q');
    }
    
    if (params.minPrice !== undefined) {
        if (params.minPrice !== null) url.searchParams.set('min_price', params.minPrice.toString());
        else url.searchParams.delete('min_price');
    }
    
    if (params.maxPrice !== undefined) {
        if (params.maxPrice !== null) url.searchParams.set('max_price', params.maxPrice.toString());
        else url.searchParams.delete('max_price');
    }
    
    if (params.showOos !== undefined) {
        if (params.showOos) url.searchParams.set('show_oos', 'true');
        else url.searchParams.delete('show_oos');
    }
    
    if (params.sort !== undefined) {
        if (params.sort !== DEFAULT_SORT) url.searchParams.set('sort', params.sort);
        else url.searchParams.delete('sort');
    }
    
    if (params.dir !== undefined) {
        if (params.dir !== DEFAULT_DIR) url.searchParams.set('dir', params.dir);
        else url.searchParams.delete('dir');
    }
    
    return url.pathname + url.search;
}
