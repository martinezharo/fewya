import { strings } from '../core/i18n';

export const sellerNavItems = [
    { href: '/sell/shop', label: strings.sellerNavShop, icon: 'store' as const },
    { href: '/sell/orders', label: strings.sellerNavOrders, icon: 'package' as const },
    { href: '/sell/catalog', label: strings.sellerNavCatalog, icon: 'grid' as const },
    { href: '/sell/reviews', label: strings.sellerNavReviews, icon: 'star' as const },
    { href: '/sell/claims', label: strings.sellerNavClaims, icon: 'alert-circle' as const },
] satisfies { href: string; label: string; icon: string }[];

export const sellerDetailsNavItem = {
    href: '/sell/details',
    label: strings.sellerNavDetails,
    icon: 'user' as const,
} satisfies { href: string; label: string; icon: string };

export const sellerFooterNavItem = {
    href: '/sell/settings',
    label: strings.sellerNavSettings,
    icon: 'settings' as const,
} satisfies { href: string; label: string; icon: string };
