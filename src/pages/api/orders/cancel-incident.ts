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
        return jsonResponse({ error: strings.incidentCancelError }, 500);
    }

    const destErrors = await validatePayoutDestinations(stripe, fetched.items);
    if (destErrors.length > 0) {
        console.error(JSON.stringify({
            event: 'cancel_incident.payout_destination_invalid',
            orderId,
            errors: destErrors,
        }));
        return jsonResponse({ error: strings.orderPayoutDestinationUnavailable }, 400);
    }

    // Confirm delivery (works from 'incident' status per migration 20260528-confirm-delivery-allow-incident.sql)
    const { data: confirmedOrder, error: confirmError } = await adminClient.rpc(
        'confirm_order_delivery',
        { p_actor_id: user.id, p_order_id: orderId }
    );

    if (confirmError) {
        console.error('confirm_order_delivery (cancel-incident) failed', confirmError);
        return jsonResponse({ error: strings.incidentCancelError }, 400);
    }

    const order = Array.isArray(confirmedOrder) ? confirmedOrder[0] : confirmedOrder;
    if (!order?.id) {
        return jsonResponse({ error: strings.incidentCancelError }, 400);
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
    await createAutoReviewsForOrder(order.id);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
