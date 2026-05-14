import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
import { buildPayoutItemsFromJoins, type JoinedOrderItem } from '../../../lib/orders/orderJoins';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    // 1. Auto-confirm all delivered orders past 48h
    const adminClient = createSupabaseAdminClient();
    const { data: confirmedRows, error: autoConfirmError } = await adminClient.rpc(
        'auto_confirm_delivered_orders',
        { p_actor_id: user.id }
    );

    if (autoConfirmError) {
        console.error(JSON.stringify({ event: 'auto_confirm_delivered_orders.failed', error: autoConfirmError.message }));
        return jsonResponse({ error: 'Auto-confirm failed' }, 500);
    }

    const autoConfirmed = Array.isArray(confirmedRows) ? confirmedRows : [];

    if (autoConfirmed.length === 0) {
        return jsonResponse({ success: true, autoConfirmed: 0, released: [], failed: [] }, 200);
    }

    const confirmedIds = autoConfirmed.map(r => (r as { order_id: string }).order_id);

    // 2. Batch-fetch all order details + items in parallel (replaces N+1 loop)
    const [ordersRes, itemsRes] = await Promise.all([
        adminClient
            .from('orders')
            .select('id, public_id, stripe_payment_intent_id')
            .in('id', confirmedIds),
        adminClient
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
            .in('order_id', confirmedIds),
    ]);

    const itemsByOrder = new Map<string, JoinedOrderItem[]>();
    for (const rawItem of itemsRes.data ?? []) {
        const item = rawItem as JoinedOrderItem;
        const orderId = item.order_id;
        if (!orderId) continue;
        if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
        itemsByOrder.get(orderId)!.push(item);
    }

    const stripe = getStripeClient();

    // 3. Release funds for all confirmed orders in parallel
    const releaseResults = await Promise.allSettled(
        (ordersRes.data ?? []).map(async order => {
            if (!order.stripe_payment_intent_id) {
                return { publicId: order.public_id, success: false };
            }

            const orderItems = itemsByOrder.get(order.id) ?? [];
            const payoutItems = buildPayoutItemsFromJoins(orderItems);

            const result = await releaseOrderFunds({
                stripe,
                orderId: order.id,
                publicId: order.public_id,
                paymentIntentId: order.stripe_payment_intent_id,
                items: payoutItems,
            });

            return { publicId: order.public_id, success: result.success, error: result.error };
        })
    );

    const released: string[] = [];
    const failed: string[] = [];

    for (const result of releaseResults) {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                released.push(result.value.publicId);
            } else {
                console.error(JSON.stringify({
                    event: 'auto_confirm.fund_release_failed',
                    publicId: result.value.publicId,
                    error: result.value.error,
                }));
                failed.push(result.value.publicId);
            }
        } else {
            console.error(JSON.stringify({
                event: 'auto_confirm.unexpected_rejection',
                reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
            }));
        }
    }

    // Use waitUntil to respond fast — transfers already done above but log any cleanup
    const ctx = (locals as { runtime?: { ctx?: { waitUntil: (p: Promise<unknown>) => void } } }).runtime?.ctx;
    if (ctx && failed.length > 0) {
        ctx.waitUntil(
            Promise.resolve(console.warn(JSON.stringify({
                event: 'auto_confirm.retry_needed',
                failed,
            })))
        );
    }

    return jsonResponse({
        success: true,
        autoConfirmed: autoConfirmed.length,
        released,
        failed,
    }, 200);
};
