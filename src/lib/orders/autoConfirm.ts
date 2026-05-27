import { createSupabaseAdminClient } from '../core/supabase-admin';
import { getStripeClient } from '../payments/stripe';
import { releaseOrderFunds } from '../cart/checkout';
import { buildPayoutItemsFromJoins, type JoinedOrderItem } from './orderJoins';
import { getLabelCostByShop } from './shipmentCost';
import { ORDER_STATUS, FUNDS_RELEASE_STATUS } from './orderStatus';

const FUND_HOLD_HOURS = 48;

/**
 * Confirms delivered orders past the 48h hold and releases their funds.
 *
 * Shared by the cron `scheduled()` handler and the HTTP endpoint. Reads env via
 * astro:env at call time, so it is safe to invoke from the scheduled context.
 */
export async function runAutoConfirm(): Promise<{ autoConfirmed: number; released: string[]; failed: string[] }> {
    const adminClient = createSupabaseAdminClient();

    // Find all delivered orders past the 48h hold period without released funds
    const cutoffTime = new Date(Date.now() - FUND_HOLD_HOURS * 60 * 60 * 1000).toISOString();

    const { data: eligibleOrders, error: fetchError } = await adminClient
        .from('orders')
        .select('id, public_id, stripe_payment_intent_id')
        .eq('status', ORDER_STATUS.DELIVERED)
        .lt('delivered_at', cutoffTime)
        .is('funds_released_at', null);

    if (fetchError) {
        console.error(JSON.stringify({ event: 'auto_confirm.fetch_failed', error: fetchError.message }));
        throw new Error(fetchError.message);
    }

    if (!eligibleOrders || eligibleOrders.length === 0) {
        return { autoConfirmed: 0, released: [], failed: [] };
    }

    const now = new Date().toISOString();
    const confirmedIds = eligibleOrders.map(o => o.id);

    // Mark all as confirmed in DB
    const { error: updateError } = await adminClient
        .from('orders')
        .update({ status: ORDER_STATUS.CONFIRMED, funds_released_at: now })
        .in('id', confirmedIds)
        .eq('status', ORDER_STATUS.DELIVERED);

    if (updateError) {
        console.error(JSON.stringify({ event: 'auto_confirm.update_failed', error: updateError.message }));
        throw new Error(updateError.message);
    }

    // Batch-fetch order items for payout calculation
    const { data: itemsData } = await adminClient
        .from('order_items')
        .select(`
            order_id,
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
        `)
        .in('order_id', confirmedIds);

    const itemsByOrder = new Map<string, JoinedOrderItem[]>();
    for (const rawItem of itemsData ?? []) {
        const item = rawItem as JoinedOrderItem;
        const orderId = item.order_id;
        if (!orderId) continue;
        if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
        itemsByOrder.get(orderId)!.push(item);
    }

    const stripe = getStripeClient();
    const released: string[] = [];
    const failed: string[] = [];

    await Promise.allSettled(
        eligibleOrders.map(async order => {
            if (!order.stripe_payment_intent_id) {
                failed.push(order.public_id);
                return;
            }

            const payoutItems = buildPayoutItemsFromJoins(itemsByOrder.get(order.id) ?? []);
            const labelCostByShop = await getLabelCostByShop(adminClient, order.id);
            const result = await releaseOrderFunds({
                stripe,
                orderId: order.id,
                publicId: order.public_id,
                paymentIntentId: order.stripe_payment_intent_id,
                items: payoutItems,
                labelCostByShop,
            });

            // C3: record payout status
            await adminClient
                .from('orders')
                .update({
                    funds_release_status: result.success ? FUNDS_RELEASE_STATUS.RELEASED : FUNDS_RELEASE_STATUS.FAILED,
                    funds_release_last_error: result.success ? null : (result.error ?? null),
                })
                .eq('id', order.id);

            if (result.success) {
                released.push(order.public_id);
            } else {
                console.error(JSON.stringify({
                    event: 'auto_confirm.fund_release_failed',
                    publicId: order.public_id,
                    error: result.error,
                }));
                failed.push(order.public_id);
            }
        })
    );

    if (failed.length > 0) {
        console.warn(JSON.stringify({ event: 'auto_confirm.retry_needed', failed }));
    }

    return { autoConfirmed: eligibleOrders.length, released, failed };
}
