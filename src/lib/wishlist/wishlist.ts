import type { SupabaseClient } from '@supabase/supabase-js';

export async function getWishlistCount(client: SupabaseClient, userId: string): Promise<number> {
    const { count } = await client
        .from('wishlist')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', userId);
    return count ?? 0;
}
