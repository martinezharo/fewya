import type { AstroCookies } from 'astro';
import { api } from '../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../core/auth';
import { createConvexClient } from '../core/convex';
import { getMergedWishlistCount } from '../wishlist/wishlist';
import { getWishlistIdsFromCookie } from '../wishlist/wishlist';
import { isProfileComplete } from '../core/validation';

export interface BuyerShellState {
    isLoggedIn: boolean;
    wishlistCount: number;
    profileIncomplete: boolean;
}

export async function getBuyerShellState(cookies: AstroCookies, request: Request): Promise<BuyerShellState> {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    const convexToken = getRequestConvexToken(request);
    let wishlistCount: number;
    if (convexToken) {
        const convex = createConvexClient(convexToken);
        try {
            const ids = convex ? await convex.query(api.wishlist.mine, {}) : [];
            wishlistCount = new Set([...ids, ...getWishlistIdsFromCookie(cookies)]).size;
        } catch (error) {
            console.error('Convex wishlist count unavailable:', error);
            wishlistCount = await getMergedWishlistCount(authClient, cookies, user?.id ?? null);
        }
    } else {
        wishlistCount = await getMergedWishlistCount(authClient, cookies, user?.id ?? null);
    }

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
