import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseOrderFunds, type CheckoutPricedItem } from '../cart/checkout';
import { buildPayoutItemsFromJoins, type JoinedOrderItem } from './orderJoins';
import { getLabelCostByShop } from './shipmentCost';
import { FUNDS_RELEASE_STATUS } from './orderStatus';

const ITEMS_JOIN = `
    quantity,
    price_at_purchase,
    product_variants (
        shipping_cost,
        products (
            shops (
                id,
                name,
                slug,
                shop_payment_accounts (
                    stripe_account_id
                )
            )
        )
    )
`;

export interface PayoutOrderRef {
    id: string;
    public_id: string;
    stripe_payment_intent_id: string | null;
}

/**
 * Fetch order items and build the payout list. Returns the items joined with
 * shop + payment account so callers can pre-validate destinations before
 * touching DB state.
 */
export async function fetchPayoutItems(
    adminClient: SupabaseClient,
    orderId: string,
): Promise<{ items: CheckoutPricedItem[]; error?: string }> {
    const { data: rows, error } = await adminClient
        .from('order_items')
        .select(ITEMS_JOIN)
        .eq('order_id', orderId);

    if (error || !rows) {
        return { items: [], error: error?.message ?? 'Could not fetch order items' };
    }

    return { items: buildPayoutItemsFromJoins(rows as unknown as JoinedOrderItem[]) };
}

/**
 * Release held funds and persist the outcome on the order row.
 *
 * Returns success/error. Always writes `funds_release_status` and
 * `funds_release_last_error` regardless of outcome so cron retries and the
 * seller's retry endpoint can discover pending work.
 */
export async function releaseAndRecord(opts: {
    adminClient: SupabaseClient;
    stripe: Stripe;
    order: PayoutOrderRef;
    items: CheckoutPricedItem[];
}): Promise<{ success: boolean; error?: string }> {
    const { adminClient, stripe, order, items } = opts;

    if (!order.stripe_payment_intent_id) {
        const error = 'Missing stripe_payment_intent_id';
        await adminClient
            .from('orders')
            .update({
                funds_release_status: FUNDS_RELEASE_STATUS.FAILED,
                funds_release_last_error: error,
            })
            .eq('id', order.id);
        return { success: false, error };
    }

    const labelCostByShop = await getLabelCostByShop(adminClient, order.id);

    const result = await releaseOrderFunds({
        stripe,
        orderId: order.id,
        publicId: order.public_id,
        paymentIntentId: order.stripe_payment_intent_id,
        items,
        labelCostByShop,
    });

    await adminClient
        .from('orders')
        .update({
            funds_release_status: result.success ? FUNDS_RELEASE_STATUS.RELEASED : FUNDS_RELEASE_STATUS.FAILED,
            funds_release_last_error: result.success ? null : (result.error ?? null),
        })
        .eq('id', order.id);

    return result;
}

/**
 * Convenience: fetch items + release + record in one shot. Use when the caller
 * doesn't need to pre-validate destinations (e.g. cron retries, seller-side
 * retries where the seller knowingly triggered it).
 */
export async function fetchAndReleaseFunds(opts: {
    adminClient: SupabaseClient;
    stripe: Stripe;
    order: PayoutOrderRef;
}): Promise<{ success: boolean; error?: string }> {
    const fetched = await fetchPayoutItems(opts.adminClient, opts.order.id);
    if (fetched.error) {
        return { success: false, error: fetched.error };
    }
    return releaseAndRecord({ ...opts, items: fetched.items });
}
