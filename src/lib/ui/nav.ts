import { strings } from '../core/i18n';

export const navItems = [
    { href: '/', label: strings.navHome, icon: 'home' as const },
    { href: '/wishlist', label: strings.navWishlist, icon: 'heart' as const, showBadge: true, badgeType: 'wishlist' as const },
    { href: '/me', label: strings.navProfile, icon: 'user' as const },
    { href: '/cart', label: strings.navCart, icon: 'shopping-cart' as const, showBadge: true, badgeType: 'cart' as const },
    { href: '/sell', label: strings.navSell, icon: 'tag' as const },
] satisfies { href: string; label: string; icon: string; showBadge?: boolean; badgeType?: string }[];
