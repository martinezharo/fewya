import type { Strings } from '../core/i18n';

export function getSellerNavItems(t: Strings) {
    return [
        { href: '/sell/orders', label: t.sellerNavOrders, icon: 'package' as const },
        { href: '/sell/catalog', label: t.sellerNavCatalog, icon: 'grid' as const },
        { href: '/sell/reviews', label: t.sellerNavReviews, icon: 'star' as const },
        { href: '/sell/claims', label: t.sellerNavClaims, icon: 'alert-circle' as const },
        { href: '/sell/shop', label: t.sellerNavShop, icon: 'store' as const },
        { href: '/sell/shipping', label: t.sellerNavShipping, icon: 'truck' as const },
    ] satisfies { href: string; label: string; icon: string }[];
}

export function getSellerDetailsNavItem(t: Strings) {
    return {
        href: '/sell/details',
        label: t.sellerNavDetails,
        icon: 'user' as const,
    } satisfies { href: string; label: string; icon: string };
}

export function getSellerFooterNavItem(t: Strings) {
    return {
        href: '/sell/settings',
        label: t.sellerNavSettings,
        icon: 'settings' as const,
    } satisfies { href: string; label: string; icon: string };
}
