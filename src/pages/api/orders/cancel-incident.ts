import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';

import { getStripeClient } from '../../../lib/payments/stripe';
import { validatePayoutDestinations } from '../../../lib/payments/payoutValidation';
import { createAutoReviews, releaseAndRecordFunds } from '../../../lib/orders/convexPayout';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);
    if (!convex) return jsonResponse({ error: t.apiUnauthorized }, 401);

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
    if (!CONVEX_WEBHOOK_SECRET) return jsonResponse({ error: t.apiInternalError }, 503);

    try {
        // Ownership is enforced in Convex: only the buyer of this order can
        // read its payout context, and only they can cancel their incident.
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        if (payout.status !== 'incident') return jsonResponse({ error: t.incidentCancelError }, 400);
        if (!payout.stripePaymentIntentId) return jsonResponse({ error: t.incidentCancelError }, 400);

        const stripe = getStripeClient();

        // Pre-validate Stripe destinations BEFORE flipping status. If a
        // seller's Connect account is missing or disabled, the order stays in
        // 'incident' so the buyer can retry once the seller fixes it.
        const destErrors = await validatePayoutDestinations(stripe, payout.items);
        if (destErrors.length > 0) {
            console.error(JSON.stringify({
                event: 'cancel_incident.payout_destination_invalid',
                orderId,
                errors: destErrors,
            }));
            return jsonResponse({ error: t.orderPayoutDestinationUnavailable }, 400);
        }

        const confirmed = await convex.mutation(api.orders.confirmDeliveryForBuyer, { orderId });
        const releaseResult = await releaseAndRecordFunds({
            convex,
            stripe,
            secret: CONVEX_WEBHOOK_SECRET,
            orderId,
            payout,
        });
        if (!releaseResult.success) {
            console.error('releaseOrderFunds failed after incident cancellation', releaseResult.error);
            return jsonResponse({
                error: 'Incident cancelled but fund release failed. Our team will resolve this.',
                orderId,
            }, 500);
        }

        await createAutoReviews({ convex, secret: CONVEX_WEBHOOK_SECRET, orderId, comment: t.autoReviewComment });

        return jsonResponse({ success: true, orderId: confirmed.orderId, publicId: confirmed.publicId }, 200);
    } catch (error) {
        console.error('Convex cancel incident failed', error);
        return jsonResponse({ error: t.incidentCancelError }, 400);
    }
};
