import type { CheckoutPricedItem } from '../cart/checkout';

export interface JoinedPaymentAccount {
    stripe_account_id: string | null;
    charges_enabled?: boolean | null;
    payouts_enabled?: boolean | null;
    details_submitted?: boolean | null;
}

export interface JoinedShop {
    id: string;
    name: string;
    slug: string;
    is_active?: boolean | null;
    owner_id?: string | null;
    seller_details_complete?: boolean | null;
    shop_payment_accounts?: JoinedPaymentAccount | JoinedPaymentAccount[] | null;
}

export interface JoinedProduct {
    id: string;
    title: string;
    slug: string;
    is_active?: boolean | null;
    gallery_images?: string[] | null;
    shops?: JoinedShop | JoinedShop[] | null;
}

export interface JoinedVariant {
    id?: string;
    price?: number | null;
    stock?: number | null;
    variant_name?: string | null;
    variant_image?: string | null;
    shipping_cost?: number | null;
    product_id?: string;
    products?: JoinedProduct | JoinedProduct[] | null;
}

export interface JoinedOrderItem {
    order_id?: string;
    quantity?: number | null;
    price_at_purchase?: number | null;
    product_variants?: JoinedVariant | JoinedVariant[] | null;
}

export function pickOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value ?? null;
}

export interface PayoutExtractContext {
    quantity: number;
    unitPrice: number;
    shippingCost: number;
    shop: JoinedShop | null;
    paymentAccount: JoinedPaymentAccount | null;
    variant: JoinedVariant | null;
    product: JoinedProduct | null;
}

export function extractPayoutContext(item: JoinedOrderItem): PayoutExtractContext {
    const variant = pickOne(item.product_variants);
    const product = pickOne(variant?.products ?? null);
    const shop = pickOne(product?.shops ?? null);
    const paymentAccount = pickOne(shop?.shop_payment_accounts ?? null);
    return {
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.price_at_purchase ?? 0),
        shippingCost: Number(variant?.shipping_cost ?? 0),
        shop,
        paymentAccount,
        variant,
        product,
    };
}

/**
 * Build the payout list (one entry per order item) used by releaseOrderFunds.
 * Items without a payable shop or Stripe account are skipped.
 */
export function buildPayoutItemsFromJoins(items: JoinedOrderItem[]): CheckoutPricedItem[] {
    const result: CheckoutPricedItem[] = [];
    for (const item of items) {
        const ctx = extractPayoutContext(item);
        if (!ctx.shop || !ctx.paymentAccount?.stripe_account_id) continue;
        result.push({
            shopId: ctx.shop.id,
            shopName: ctx.shop.name,
            shopSlug: ctx.shop.slug,
            stripeAccountId: ctx.paymentAccount.stripe_account_id,
            quantity: ctx.quantity,
            unitPrice: ctx.unitPrice,
            shippingCost: ctx.shippingCost,
        });
    }
    return result;
}
