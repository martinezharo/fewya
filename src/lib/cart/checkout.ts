export const CHECKOUT_CURRENCY = 'eur';
export const SHIPPING_SUBSIDY = 2;

const CARRIER_SUBSIDIES: Record<string, number> = {
    inpost: 1.5,
};

export function getCarrierSubsidy(carrierKey: string): number {
    return CARRIER_SUBSIDIES[carrierKey] ?? SHIPPING_SUBSIDY;
}

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
    stripe: import('stripe').default;
    orderId: string;
    publicId: string;
    paymentIntentId: string;
    items: CheckoutPricedItem[];
}): Promise<{ success: boolean; error?: string }> {
    const { stripe, orderId, publicId, paymentIntentId, items } = options;

    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        const transferGroup = paymentIntent.transfer_group || `order_${publicId}`;
        const payoutBreakdown = buildShopPayouts(items);

        const results = await Promise.allSettled(
            payoutBreakdown.map(payout =>
                stripe.transfers.create({
                    amount: toMinorUnits(payout.total),
                    currency: CHECKOUT_CURRENCY,
                    destination: payout.stripeAccountId,
                    transfer_group: transferGroup,
                    metadata: { orderId, publicId, shopId: payout.shopId },
                }, {
                    idempotencyKey: `order-transfer:${orderId}:${payout.shopId}`,
                })
            )
        );

        const failures = results
            .map((r, i) => ({ result: r, payout: payoutBreakdown[i] }))
            .filter(({ result }) => result.status === 'rejected');

        if (failures.length > 0) {
            const errors = failures.map(({ result, payout }) =>
                `${payout.shopId}: ${(result as PromiseRejectedResult).reason?.message ?? 'unknown'}`
            );
            console.error(JSON.stringify({
                event: 'release_order_funds.partial_failure',
                orderId,
                publicId,
                errors,
            }));
            return { success: false, error: errors.join('; ') };
        }

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Transfer failed';
        console.error(JSON.stringify({
            event: 'release_order_funds.failed',
            orderId,
            publicId,
            error: error instanceof Error ? error.message : String(error),
        }));
        return { success: false, error: message };
    }
}