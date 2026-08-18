import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

import { getStripeClient } from '../../../lib/payments/stripe';
import { validatePayoutDestinations } from '../../../lib/payments/payoutValidation';
import { createAutoReviewsForOrder } from '../../../lib/orders/autoReview';
import { fetchPayoutItems, releaseAndRecord } from '../../../lib/orders/payoutFlow';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
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
            if (payout.status !== 'incident') return jsonResponse({ error: t.incidentCancelError }, 400);
            const stripe = getStripeClient();
            const destErrors = await validatePayoutDestinations(stripe, payout.items);
            if (destErrors.length > 0) return jsonResponse({ error: t.orderPayoutDestinationUnavailable }, 400);
            if (!payout.stripePaymentIntentId) return jsonResponse({ error: t.incidentCancelError }, 400);

            const confirmed = await convex.mutation(api.orders.confirmDeliveryForBuyer, { orderId });
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
            if (!releaseResult.success) {
                return jsonResponse({ error: 'Incident cancelled but fund release failed. Our team will resolve this.', orderId }, 500);
            }
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
            console.error('Convex cancel incident failed', error);
            return jsonResponse({ error: t.incidentCancelError }, 400);
        }
    }

    if (convexOnly) return jsonResponse({ error: t.incidentCancelError }, 404);

    const adminClient = createSupabaseAdminClient();

    // Ownership check BEFORE any Stripe calls: only the buyer may cancel the
    // incident on their own order. The RPC below also enforces this, but
    // checking here first avoids exposing Stripe account lookups (needless
    // API/rate-limit surface) for an order id the caller doesn't own.
    const { data: ownedOrder } = await adminClient
        .from('orders')
        .select('id')
        .eq('id', orderId)
        .eq('buyer_id', user.id)
        .single();

    if (!ownedOrder) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const stripe = getStripeClient();

    // Pre-validate Stripe destinations BEFORE flipping status. If a seller's
    // Connect account is missing or disabled, we leave the order in 'incident'
    // so the buyer can retry later or the seller can fix their account.
    const fetched = await fetchPayoutItems(adminClient, orderId);
    if (fetched.error) {
        console.error(JSON.stringify({
            event: 'cancel_incident.fetch_items_failed',
            orderId,
            error: fetched.error,
        }));
        return jsonResponse({ error: t.incidentCancelError }, 500);
    }

    const destErrors = await validatePayoutDestinations(stripe, fetched.items);
    if (destErrors.length > 0) {
        console.error(JSON.stringify({
            event: 'cancel_incident.payout_destination_invalid',
            orderId,
            errors: destErrors,
        }));
        return jsonResponse({ error: t.orderPayoutDestinationUnavailable }, 400);
    }

    // Confirm delivery (works from 'incident' status per migration 20260528-confirm-delivery-allow-incident.sql)
    const { data: confirmedOrder, error: confirmError } = await adminClient.rpc(
        'confirm_order_delivery',
        { p_actor_id: user.id, p_order_id: orderId }
    );

    if (confirmError) {
        console.error('confirm_order_delivery (cancel-incident) failed', confirmError);
        return jsonResponse({ error: t.incidentCancelError }, 400);
    }

    const order = Array.isArray(confirmedOrder) ? confirmedOrder[0] : confirmedOrder;
    if (!order?.id) {
        return jsonResponse({ error: t.incidentCancelError }, 400);
    }

    const releaseResult = await releaseAndRecord({
        adminClient,
        stripe,
        order: { id: order.id, public_id: order.public_id, stripe_payment_intent_id: order.stripe_payment_intent_id },
        items: fetched.items,
    });

    if (!releaseResult.success) {
        console.error('releaseOrderFunds failed after incident cancellation', releaseResult.error);
        return jsonResponse({
            error: 'Incident cancelled but fund release failed. Our team will resolve this.',
            orderId: order.id,
        }, 500);
    }

    // Create auto-reviews for products in this order (silent — non-critical)
    await createAutoReviewsForOrder(order.id, t);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
