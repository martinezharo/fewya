import type { AstroCookies } from 'astro';
import { createSupabaseAuthClient } from '../core/auth';
import { getMergedWishlistCount } from '../wishlist/wishlist';

export interface BuyerShellState {
    isLoggedIn: boolean;
    wishlistCount: number;
}

export async function getBuyerShellState(cookies: AstroCookies, request: Request): Promise<BuyerShellState> {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    const wishlistCount = await getMergedWishlistCount(authClient, cookies, user?.id ?? null);

    return {
        isLoggedIn: !!user,
        wishlistCount,
    };
}