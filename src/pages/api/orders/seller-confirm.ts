import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { createConvexClient } from '../../../lib/core/convex';

import { getStripeClient } from '../../../lib/payments/stripe';
import { createAutoReviewsForOrder } from '../../../lib/orders/autoReview';
import { pickOne } from '../../../lib/orders/orderJoins';
import { FUND_HOLD_MS } from '../../../lib/orders/timing';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';
import { fetchAndReleaseFunds } from '../../../lib/orders/payoutFlow';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
import { validatePayoutDestinations } from '../../../lib/payments/payoutValidation';
import { convexOnly } from '../../../lib/core/env';

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

    if (orderId.startsWith('convex:')) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex || !CONVEX_WEBHOOK_SECRET) return jsonResponse({ error: t.apiUnauthorized }, 401);
        try {
            const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
            const cutoff = Date.now() - FUND_HOLD_MS;
            if (payout.status !== ORDER_STATUS.DELIVERED || payout.deliveredAt == null || payout.deliveredAt >= cutoff) {
                return jsonResponse({ error: t.apiInvalidBody }, 400);
            }
            if (!payout.stripePaymentIntentId) return jsonResponse({ error: t.apiInternalError }, 400);
            const stripe = getStripeClient();
            const destinationErrors = await validatePayoutDestinations(stripe, payout.items);
            if (destinationErrors.length > 0) return jsonResponse({ error: t.orderPayoutDestinationUnavailable }, 400);
            const confirmed = await convex.mutation(api.orders.confirmDeliveryForSeller, { orderId, cutoff });
            const releaseResult = await releaseOrderFunds({
                stripe,
                orderId: payout.id,
                publicId: payout.publicId,
                paymentIntentId: payout.stripePaymentIntentId,
                items: payout.items,
                labelCostByShop: payout.labelCostByShop,
            });
            await convex.mutation(api.orders.recordFundsRelease, {
                secret: CONVEX_WEBHOOK_SECRET,
                orderId,
                success: releaseResult.success,
                ...(releaseResult.error ? { error: releaseResult.error } : {}),
            });
            if (!releaseResult.success) return jsonResponse({ error: t.sellerOrderRefundUnexpectedError, orderId }, 500);
            try {
                await convex.mutation(api.reviews.createAutoForOrder, {
                    secret: CONVEX_WEBHOOK_SECRET,
                    orderId,
                    comment: t.autoReviewComment,
                });
            } catch (error) {
                console.error('Convex auto-review creation failed', error);
            }
            return jsonResponse({ success: true, orderId: confirmed.orderId, publicId: confirmed.publicId }, 200);
        } catch (error) {
            console.error('Convex seller confirm failed', error);
            return jsonResponse({ error: t.sellerOrderConfirmDeliveryError }, 500);
        }
    }

    if (convexOnly) return jsonResponse({ error: t.sellerOrderConfirmDeliveryError }, 404);

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
