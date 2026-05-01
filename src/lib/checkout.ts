export const CHECKOUT_CURRENCY = 'eur';
export const SHOP_SHIPPING_EUR = 3.49;
export const DEFAULT_SHOP_SHIPPING_EUR = 3.49;

export interface CheckoutPricedItem {
    shopId: string;
    shopName: string;
    shopSlug: string;
    stripeAccountId: string;
    quantity: number;
    unitPrice: number;
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
    items: CheckoutPricedItem[],
    shopShippingMap?: Map<string, number>
): ShopPayoutBreakdown[] {
    const shopMap = new Map<string, ShopPayoutBreakdown>();

    for (const item of items) {
        const existing = shopMap.get(item.shopId);

        if (existing) {
            existing.subtotal += item.unitPrice * item.quantity;
            existing.total = existing.subtotal + existing.shipping;
            continue;
        }

        const shipping = shopShippingMap?.get(item.shopId) ?? DEFAULT_SHOP_SHIPPING_EUR;

        shopMap.set(item.shopId, {
            shopId: item.shopId,
            shopName: item.shopName,
            shopSlug: item.shopSlug,
            stripeAccountId: item.stripeAccountId,
            subtotal: item.unitPrice * item.quantity,
            shipping,
            total: item.unitPrice * item.quantity + shipping,
        });
    }

    return Array.from(shopMap.values());
}

export function calculateOrderTotal(items: CheckoutPricedItem[], shopShippingMap?: Map<string, number>): number {
    return buildShopPayouts(items, shopShippingMap).reduce((sum, payout) => sum + payout.total, 0);
}