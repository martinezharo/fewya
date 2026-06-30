import type { Strings } from '../core/i18n';

export function getNavItems(t: Strings) {
    return [
        { href: '/', label: t.navHome, icon: 'home' as const },
        { href: '/wishlist', label: t.navWishlist, icon: 'heart' as const, showBadge: true, badgeType: 'wishlist' as const },
        { href: '/me', label: t.navProfile, icon: 'user' as const },
        { href: '/cart', label: t.navCart, icon: 'shopping-cart' as const, showBadge: true, badgeType: 'cart' as const },
        { href: '/sell', label: t.navSell, icon: 'tag' as const },
    ] satisfies { href: string; label: string; icon: string; showBadge?: boolean; badgeType?: string }[];
}
