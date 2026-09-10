import type { AstroCookies } from 'astro';
import { api } from '../../../convex/_generated/api';
import { createRequestConvexClient, getRequestUser } from '../core/auth';
import { getMergedWishlistCount, getWishlistIdsFromCookie } from '../wishlist/wishlist';
import { toProfileFields } from '../core/profile';
import { isProfileComplete } from '../core/validation';

export interface BuyerShellState {
    isLoggedIn: boolean;
    wishlistCount: number;
    profileIncomplete: boolean;
}

export async function getBuyerShellState(cookies: AstroCookies, request: Request): Promise<BuyerShellState> {
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return {
            isLoggedIn: false,
            wishlistCount: getWishlistIdsFromCookie(cookies).length,
            profileIncomplete: false,
        };
    }

    let wishlistCount: number;
    try {
        const ids = await convex.query(api.wishlist.mine, {});
        wishlistCount = new Set([...ids, ...getWishlistIdsFromCookie(cookies)]).size;
    } catch (error) {
        console.error('Convex wishlist count unavailable:', error);
        wishlistCount = await getMergedWishlistCount(cookies, request);
    }

    let profileIncomplete = false;
    try {
        const profile = toProfileFields(await convex.query(api.users.current, {}));
        profileIncomplete = profile ? !isProfileComplete(profile).complete : false;
    } catch (error) {
        console.error('Convex profile status unavailable:', error);
    }

    return {
        isLoggedIn: Boolean(user),
        wishlistCount,
        profileIncomplete,
    };
}
