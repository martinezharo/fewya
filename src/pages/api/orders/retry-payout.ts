import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
import { buildPayoutItemsFromJoins, type JoinedOrderItem } from '../../../lib/orders/orderJoins';
import { getLabelCostByShop } from '../../../lib/orders/shipmentCost';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const adminClient = createSupabaseAdminClient();

    // Verify the seller owns this order's shop
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select(`
            id, public_id, stripe_payment_intent_id, funds_release_status,
            shops!inner(id, owner_id)
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    type OrderWithShop = {
        id: string;
        public_id: string;
        stripe_payment_intent_id: string | null;
        funds_release_status: string;
        shops: { id: string; owner_id: string | null } | { id: string; owner_id: string | null }[] | null;
    };
    const typedOrder = order as unknown as OrderWithShop;
    const shop = Array.isArray(typedOrder.shops) ? typedOrder.shops[0] : typedOrder.shops;
    if (shop?.owner_id !== user.id) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    if (typedOrder.funds_release_status !== 'failed') {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    if (!typedOrder.stripe_payment_intent_id) {
        return jsonResponse({ error: strings.apiInternalError }, 400);
    }

    // Fetch order items
    const { data: orderItems } = await adminClient
        .from('order_items')
        .select(`
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
        .eq('order_id', orderId);

    const payoutItems = buildPayoutItemsFromJoins((orderItems ?? []) as JoinedOrderItem[]);

    const stripe = getStripeClient();
    const labelCostByShop = await getLabelCostByShop(adminClient, typedOrder.id);
    const releaseResult = await releaseOrderFunds({
        stripe,
        orderId: typedOrder.id,
        publicId: typedOrder.public_id,
        paymentIntentId: typedOrder.stripe_payment_intent_id!,
        items: payoutItems,
        labelCostByShop,
    });

    // Record payout outcome
    await adminClient
        .from('orders')
        .update({
            funds_release_status: releaseResult.success ? 'released' : 'failed',
            funds_release_last_error: releaseResult.success ? null : (releaseResult.error ?? null),
        })
        .eq('id', orderId);

    if (!releaseResult.success) {
        return jsonResponse({ error: strings.apiInternalError }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
