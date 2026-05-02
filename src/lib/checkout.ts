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

/**
 * Release held funds to sellers via Stripe transfers.
 * This should be called after an order is confirmed (buyer confirmation or 48h auto-confirm).
 */
export async function releaseOrderFunds(options: {
    stripe: any;
    orderId: string;
    publicId: string;
    paymentIntentId: string;
    items: CheckoutPricedItem[];
}): Promise<{ success: boolean; error?: string }> {
    const { stripe, orderId, publicId, paymentIntentId, items } = options;

    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge'],
        });

        const latestCharge = typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id;

        if (!latestCharge) {
            return { success: false, error: 'No charge found on payment intent' };
        }

        const payoutBreakdown = buildShopPayouts(items);

        for (const payout of payoutBreakdown) {
            await stripe.transfers.create({
                amount: toMinorUnits(payout.total),
                currency: CHECKOUT_CURRENCY,
                destination: payout.stripeAccountId,
                source_transaction: latestCharge,
                transfer_group: paymentIntent.transfer_group || `order_${publicId}`,
                metadata: {
                    orderId,
                    publicId,
                    shopId: payout.shopId,
                },
            }, {
                idempotencyKey: `order-transfer:${orderId}:${payout.shopId}`,
            });
        }

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Transfer failed';
        console.error('releaseOrderFunds failed', error);
        return { success: false, error: message };
    }
}