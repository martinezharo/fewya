import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';

import { getStripeClient } from '../../../lib/payments/stripe';
import { FUND_HOLD_MS } from '../../../lib/orders/timing';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';
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
        // Shop ownership is enforced in Convex; the cutoff keeps the seller
        // from confirming before the buyer's dispute window has elapsed.
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        const cutoff = Date.now() - FUND_HOLD_MS;
        if (payout.status !== ORDER_STATUS.DELIVERED || payout.deliveredAt == null || payout.deliveredAt >= cutoff) {
            return jsonResponse({ error: t.apiInvalidBody }, 400);
        }
        if (!payout.stripePaymentIntentId) return jsonResponse({ error: t.apiInternalError }, 400);

        const stripe = getStripeClient();
        const destinationErrors = await validatePayoutDestinations(stripe, payout.items);
        if (destinationErrors.length > 0) {
            return jsonResponse({ error: t.orderPayoutDestinationUnavailable }, 400);
        }

        const confirmed = await convex.mutation(api.orders.confirmDeliveryForSeller, { orderId, cutoff });
        const releaseResult = await releaseAndRecordFunds({
            convex,
            stripe,
            secret: CONVEX_WEBHOOK_SECRET,
            orderId,
            payout,
        });
        if (!releaseResult.success) {
            console.error('releaseOrderFunds failed after seller confirmation', releaseResult.error);
            return jsonResponse({ error: t.sellerOrderRefundUnexpectedError, orderId }, 500);
        }

        await createAutoReviews({ convex, secret: CONVEX_WEBHOOK_SECRET, orderId, comment: t.autoReviewComment });

        return jsonResponse({ success: true, orderId: confirmed.orderId, publicId: confirmed.publicId }, 200);
    } catch (error) {
        console.error('Convex seller confirm failed', error);
        return jsonResponse({ error: t.sellerOrderConfirmDeliveryError }, 500);
    }
};
