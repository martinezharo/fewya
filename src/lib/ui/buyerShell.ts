import type { AstroCookies } from 'astro';
import { createSupabaseAuthClient } from '../core/auth';
import { getMergedWishlistCount } from '../wishlist/wishlist';
import { isProfileComplete } from '../core/validation';

export interface BuyerShellState {
    isLoggedIn: boolean;
    wishlistCount: number;
    profileIncomplete: boolean;
}

export async function getBuyerShellState(cookies: AstroCookies, request: Request): Promise<BuyerShellState> {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    const wishlistCount = await getMergedWishlistCount(authClient, cookies, user?.id ?? null);

    let profileIncomplete = false;
    if (user) {
        const { data: profile } = await authClient
            .from('profiles')
            .select('first_name, last_name, phone, address_street, address_number, address_postal_code, address_city, address_province, address_country')
            .eq('id', user.id)
            .single();
        if (profile) {
            profileIncomplete = !isProfileComplete(profile).complete;
        }
    }

    return {
        isLoggedIn: !!user,
        wishlistCount,
        profileIncomplete,
    };
}