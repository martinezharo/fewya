import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { validatePayoutDestinations } from '../../../lib/payments/payoutValidation';
import { createAutoReviewsForOrder } from '../../../lib/orders/autoReview';
import { fetchPayoutItems, releaseAndRecord } from '../../../lib/orders/payoutFlow';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

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
    const stripe = getStripeClient();

    // Pre-validate destinations before flipping status. If invalid, the order
    // stays in 'delivered' and the buyer can retry once the seller fixes it.
    const fetched = await fetchPayoutItems(adminClient, orderId);
    if (fetched.error) {
        console.error(JSON.stringify({
            event: 'confirm_delivery.fetch_items_failed',
            orderId,
            error: fetched.error,
        }));
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
    }

    const destErrors = await validatePayoutDestinations(stripe, fetched.items);
    if (destErrors.length > 0) {
        console.error(JSON.stringify({
            event: 'confirm_delivery.payout_destination_invalid',
            orderId,
            errors: destErrors,
        }));
        return jsonResponse({ error: strings.orderPayoutDestinationUnavailable }, 400);
    }

    // 1. Confirm delivery in DB
    const { data: confirmedOrder, error: confirmError } = await adminClient.rpc(
        'confirm_order_delivery',
        { p_actor_id: user.id, p_order_id: orderId }
    );

    if (confirmError) {
        console.error('confirm_order_delivery failed', confirmError);
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 400);
    }

    const order = Array.isArray(confirmedOrder) ? confirmedOrder[0] : confirmedOrder;
    if (!order?.id) {
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 400);
    }

    // 2. Release funds to sellers (and persist outcome on the order)
    const releaseResult = await releaseAndRecord({
        adminClient,
        stripe,
        order: { id: order.id, public_id: order.public_id, stripe_payment_intent_id: order.stripe_payment_intent_id },
        items: fetched.items,
    });

    if (!releaseResult.success) {
        console.error('releaseOrderFunds failed after buyer confirmation', releaseResult.error);
        return jsonResponse({
            error: 'Delivery confirmed but fund release failed. Our team will resolve this.',
            orderId: order.id,
        }, 500);
    }

    // Create auto-reviews for products in this order (silent — non-critical)
    await createAutoReviewsForOrder(order.id);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
