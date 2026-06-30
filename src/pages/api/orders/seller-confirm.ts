import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

import { getStripeClient } from '../../../lib/payments/stripe';
import { createAutoReviewsForOrder } from '../../../lib/orders/autoReview';
import { pickOne } from '../../../lib/orders/orderJoins';
import { FUND_HOLD_MS } from '../../../lib/orders/timing';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';
import { fetchAndReleaseFunds } from '../../../lib/orders/payoutFlow';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request, cookies  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const adminClient = createSupabaseAdminClient();

    // 1. Fetch order and verify ownership via shop
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select(`
            id, public_id, status, delivered_at, funds_released_at,
            stripe_payment_intent_id,
            shops!inner(id, owner_id)
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    type OrderShopJoin = { id: string; owner_id: string | null };
    const shop = pickOne((order as unknown as { shops: OrderShopJoin | OrderShopJoin[] | null }).shops);
    if (shop?.owner_id !== user.id) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    if (order.status !== ORDER_STATUS.DELIVERED) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (!order.delivered_at || Date.now() - new Date(order.delivered_at).getTime() < FUND_HOLD_MS) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (order.funds_released_at) {
        // Already confirmed, idempotent success
        return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
    }

    // 2. Confirm the order
    const now = new Date().toISOString();
    const { error: updateError } = await adminClient
        .from('orders')
        .update({ status: ORDER_STATUS.CONFIRMED, funds_released_at: now })
        .eq('id', orderId);

    if (updateError) {
        console.error(JSON.stringify({
            event: 'seller_confirm.order_update_failed',
            orderId: order.id,
            publicId: order.public_id,
            error: updateError.message,
        }));
        return jsonResponse({ error: t.sellerOrderConfirmDeliveryError }, 500);
    }

    // 3. Release funds to seller via Stripe
    const stripe = getStripeClient();
    const releaseResult = await fetchAndReleaseFunds({
        adminClient,
        stripe,
        order: { id: order.id, public_id: order.public_id, stripe_payment_intent_id: order.stripe_payment_intent_id },
    });

    if (!releaseResult.success) {
        console.error(JSON.stringify({
            event: 'seller_confirm.fund_release_failed',
            orderId: order.id,
            publicId: order.public_id,
            error: releaseResult.error,
        }));
        return jsonResponse({
            error: t.sellerOrderRefundUnexpectedError,
            orderId: order.id,
        }, 500);
    }

    // 4. Create auto-reviews (silent — non-critical)
    await createAutoReviewsForOrder(orderId, t);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
