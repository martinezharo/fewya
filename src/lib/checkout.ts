export const CHECKOUT_CURRENCY = 'eur';

export interface CheckoutPricedItem {
    shopId: string;
    shopName: string;
    shopSlug: string;
    stripeAccountId: string;
    quantity: number;
    unitPrice: number;
    shippingCost: number;
}

export interface CheckoutResolvedItem extends CheckoutPricedItem {
    productId: string;
    productTitle: string;
    productSlug: string;
    variantId: string;
    variantName: string | null;
    image: string | null;
}

export interface ShopPayoutBreakdown {
    shopId: string;
    shopName: string;
    shopSlug: string;
    stripeAccountId: string;
    subtotal: number;
    shipping: number;
    total: number;
}

export function toMinorUnits(amount: number): number {
    return Math.round(amount * 100);
}

export function fromMinorUnits(amount: number): number {
    return amount / 100;
}

export function buildShopPayouts(
    items: CheckoutPricedItem[]
): ShopPayoutBreakdown[] {
    const shopMap = new Map<string, ShopPayoutBreakdown>();

    for (const item of items) {
        const existing = shopMap.get(item.shopId);

        if (existing) {
            existing.subtotal += item.unitPrice * item.quantity;
            existing.shipping = Math.max(existing.shipping, item.shippingCost);
            existing.total = existing.subtotal + existing.shipping;
            continue;
        }

        shopMap.set(item.shopId, {
            shopId: item.shopId,
            shopName: item.shopName,
            shopSlug: item.shopSlug,
            stripeAccountId: item.stripeAccountId,
            subtotal: item.unitPrice * item.quantity,
            shipping: item.shippingCost,
            total: item.unitPrice * item.quantity + item.shippingCost,
        });
    }

    return Array.from(shopMap.values());
}

export function calculateOrderTotal(items: CheckoutPricedItem[]): number {
    return buildShopPayouts(items).reduce((sum, payout) => sum + payout.total, 0);
}