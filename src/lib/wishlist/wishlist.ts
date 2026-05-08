import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

export async function getWishlistCount(client: SupabaseClient, userId: string): Promise<number> {
    const { count } = await client
        .from('wishlist')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', userId);
    return count ?? 0;
}

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

/** Merge DB wishlist IDs with local cookie IDs for authenticated users.
 *  For anonymous users, returns only local cookie IDs.
 */
export async function getMergedWishlistIds(
    client: SupabaseClient,
    cookies: AstroCookies,
    userId?: string | null
): Promise<Set<string>> {
    const merged = new Set<string>();

    // Always include local wishlist
    getWishlistIdsFromCookie(cookies).forEach(id => merged.add(id));

    if (userId) {
        const { data: wishData } = await client
            .from('wishlist')
            .select('product_id')
            .eq('profile_id', userId);
        (wishData ?? []).forEach((w: any) => merged.add(w.product_id));
    }

    return merged;
}

/** Count merged wishlist items (DB + local). */
export async function getMergedWishlistCount(
    client: SupabaseClient,
    cookies: AstroCookies,
    userId?: string | null
): Promise<number> {
    const ids = await getMergedWishlistIds(client, cookies, userId);
    return ids.size;
}
