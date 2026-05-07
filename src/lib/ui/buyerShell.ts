import type { AstroCookies } from 'astro';
import { createSupabaseAuthClient } from '../core/auth';
import { getWishlistCount } from '../wishlist/wishlist';

export interface BuyerShellState {
    isLoggedIn: boolean;
    wishlistCount: number;
}

export async function getBuyerShellState(cookies: AstroCookies, request: Request): Promise<BuyerShellState> {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    return {
        isLoggedIn: !!user,
        wishlistCount: user ? await getWishlistCount(authClient, user.id) : 0,
    };
}