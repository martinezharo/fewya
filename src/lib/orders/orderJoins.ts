/**
 * The nested shapes the checkout route hands to the shared product/pricing
 * validators. Convex returns them in this form so those validators, and the
 * UI components that consume the same objects, did not have to change with
 * the database underneath.
 */

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
    shipping_carriers?: string[] | null;
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

export function pickOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value ?? null;
}
