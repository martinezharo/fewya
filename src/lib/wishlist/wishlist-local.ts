/** Handles local wishlist storage for non-authenticated users.
 *  Syncs with a cookie so SSR can read the wishlist IDs on page load.
 */
const STORAGE_KEY = 'fewya_wishlist';
const COOKIE_NAME = 'fewya_wishlist';
const COOKIE_MAX_AGE_DAYS = 365;

function setCookie(value: string) {
    const expires = new Date(Date.now() + COOKIE_MAX_AGE_DAYS * 864e5).toUTCString();
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

function readCookie(): string | null {
    return document.cookie.split('; ').reduce<string | null>((r, v) => {
        const [key, ...rest] = v.split('=');
        return key === COOKIE_NAME ? decodeURIComponent(rest.join('=')) : r;
    }, null);
}

function readStorage(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
        }
    } catch { /* ignore */ }
    return [];
}

function writeStorage(ids: string[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    setCookie(JSON.stringify(ids));
}

/** Get current local wishlist IDs */
export function getLocalWishlistIds(): string[] {
    return readStorage();
}

/** Check if a product is locally wishlisted */
export function isLocalWishlisted(productId: string): boolean {
    return readStorage().includes(productId);
}

/** Toggle a product in the local wishlist. Returns new wishlisted state. */
export function toggleLocalWishlist(productId: string): boolean {
    const ids = readStorage();
    const idx = ids.indexOf(productId);
    let wished: boolean;
    if (idx >= 0) {
        ids.splice(idx, 1);
        wished = false;
    } else {
        ids.push(productId);
        wished = true;
    }
    writeStorage(ids);
    return wished;
}

/** Sync localStorage from cookie on first load (if storage is empty and cookie exists) */
export function syncLocalWishlistFromCookie() {
    const storage = readStorage();
    const cookie = readCookie();
    if (storage.length === 0 && cookie) {
        try {
            const parsed = JSON.parse(cookie);
            if (Array.isArray(parsed)) {
                const ids = parsed.filter((id): id is string => typeof id === 'string');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
            }
        } catch { /* ignore */ }
    }
}
