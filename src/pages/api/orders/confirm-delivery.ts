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
        // Ownership is enforced in Convex: the query only answers for an order
        // that belongs to the authenticated buyer.
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        if (!['delivered', 'incident'].includes(payout.status)) {
            return jsonResponse({ error: t.apiCheckoutConfirmationError }, 400);
        }
        if (!payout.stripePaymentIntentId) return jsonResponse({ error: t.apiCheckoutConfirmationError }, 400);

        const stripe = getStripeClient();

        // Pre-validate destinations before flipping status: if a seller's
        // Connect account is disabled the order stays as it is and the buyer
        // can retry once it is fixed.
        const destErrors = await validatePayoutDestinations(stripe, payout.items);
        if (destErrors.length > 0) {
            console.error(JSON.stringify({
                event: 'confirm_delivery.payout_destination_invalid',
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
            console.error('releaseOrderFunds failed after buyer confirmation', releaseResult.error);
            return jsonResponse({
                error: 'Delivery confirmed but fund release failed. Our team will resolve this.',
                orderId,
            }, 500);
        }

        await createAutoReviews({ convex, secret: CONVEX_WEBHOOK_SECRET, orderId, comment: t.autoReviewComment });

        return jsonResponse({ success: true, orderId: confirmed.orderId, publicId: confirmed.publicId }, 200);
    } catch (error) {
        console.error('Convex confirm delivery failed', error);
        return jsonResponse({ error: t.apiCheckoutConfirmationError }, 400);
    }
};
