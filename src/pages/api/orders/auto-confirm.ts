import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { getStripeClient } from '../../../lib/payments/stripe';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
import { buildPayoutItemsFromJoins, type JoinedOrderItem } from '../../../lib/orders/orderJoins';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';

const FUND_HOLD_HOURS = 48;

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, locals }) => {
    // M6: cron-only endpoint — authenticate with X-Cron-Secret header (timing-safe)
    const cronSecret = CRON_SECRET ?? '';
    const requestSecret = request.headers.get('X-Cron-Secret') ?? '';

    if (!cronSecret || !timingSafeEqual(requestSecret, cronSecret)) {
        securityLog('security.cron.unauthorized', { path: '/api/orders/auto-confirm' });
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const adminClient = createSupabaseAdminClient();

    // Find all delivered orders past the 48h hold period without released funds
    const cutoffTime = new Date(Date.now() - FUND_HOLD_HOURS * 60 * 60 * 1000).toISOString();

    const { data: eligibleOrders, error: fetchError } = await adminClient
        .from('orders')
        .select('id, public_id, stripe_payment_intent_id')
        .eq('status', 'delivered')
        .lt('delivered_at', cutoffTime)
        .is('funds_released_at', null);

    if (fetchError) {
        console.error(JSON.stringify({ event: 'auto_confirm.fetch_failed', error: fetchError.message }));
        return jsonResponse({ error: 'Failed to query orders' }, 500);
    }

    if (!eligibleOrders || eligibleOrders.length === 0) {
        return jsonResponse({ success: true, autoConfirmed: 0, released: [], failed: [] }, 200);
    }

    const now = new Date().toISOString();
    const confirmedIds = eligibleOrders.map(o => o.id);

    // Mark all as confirmed in DB
    const { error: updateError } = await adminClient
        .from('orders')
        .update({ status: 'confirmed', funds_released_at: now })
        .in('id', confirmedIds)
        .eq('status', 'delivered');

    if (updateError) {
        console.error(JSON.stringify({ event: 'auto_confirm.update_failed', error: updateError.message }));
        return jsonResponse({ error: 'Failed to confirm orders' }, 500);
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
            const result = await releaseOrderFunds({
                stripe,
                orderId: order.id,
                publicId: order.public_id,
                paymentIntentId: order.stripe_payment_intent_id,
                items: payoutItems,
            });

            // C3: record payout status
            await adminClient
                .from('orders')
                .update({
                    funds_release_status: result.success ? 'released' : 'failed',
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

    const ctx = (locals as { runtime?: { ctx?: { waitUntil: (p: Promise<unknown>) => void } } }).runtime?.ctx;
    if (ctx && failed.length > 0) {
        ctx.waitUntil(Promise.resolve(console.warn(JSON.stringify({
            event: 'auto_confirm.retry_needed',
            failed,
        }))));
    }

    return jsonResponse({
        success: true,
        autoConfirmed: eligibleOrders.length,
        released,
        failed,
    }, 200);
};
