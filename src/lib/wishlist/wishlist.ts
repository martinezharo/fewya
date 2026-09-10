import type { AstroCookies } from 'astro';
import { api } from '../../../convex/_generated/api';
import { createRequestConvexClient } from '../core/auth';

/** Read wishlist IDs from the synced cookie (used for non-authenticated users). */
export function getWishlistIdsFromCookie(cookies: AstroCookies): string[] {
    const raw = cookies.get('fewya_wishlist')?.value;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch { /* ignore */ }
    return [];
}

/** Merge stored wishlist IDs with local cookie IDs for authenticated users.
 *  For anonymous users, returns only local cookie IDs.
 */
export async function getMergedWishlistIds(
    cookies: AstroCookies,
    request?: Request,
): Promise<Set<string>> {
    const merged = new Set<string>();

    // Always include local wishlist
    getWishlistIdsFromCookie(cookies).forEach(id => merged.add(id));

    const convex = request ? createRequestConvexClient(request) : null;
    if (!convex) return merged;

    try {
        const ids = await convex.query(api.wishlist.mine, {});
        ids.forEach((id) => merged.add(id));
    } catch (error) {
        console.error('Convex wishlist unavailable:', error);
    }
    return merged;
}

/** Count merged wishlist items (stored + local). */
export async function getMergedWishlistCount(
    cookies: AstroCookies,
    request?: Request,
): Promise<number> {
    const ids = await getMergedWishlistIds(cookies, request);
    return ids.size;
}
