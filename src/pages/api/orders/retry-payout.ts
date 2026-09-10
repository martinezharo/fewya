import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';

import { getStripeClient } from '../../../lib/payments/stripe';
import { FUNDS_RELEASE_STATUS } from '../../../lib/orders/orderStatus';
import { releaseAndRecordFunds } from '../../../lib/orders/convexPayout';

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
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        // The buyer of an order can read this context too, but retrying a
        // payout is the seller's action: it moves money to their account.
        if (!payout.viewerIsSeller) return jsonResponse({ error: t.apiForbidden }, 403);
        if (payout.fundsReleaseStatus !== FUNDS_RELEASE_STATUS.FAILED || !payout.stripePaymentIntentId) {
            return jsonResponse({ error: t.apiInvalidBody }, 400);
        }

        const result = await releaseAndRecordFunds({
            convex,
            stripe: getStripeClient(),
            secret: CONVEX_WEBHOOK_SECRET,
            orderId,
            payout,
        });
        if (!result.success) return jsonResponse({ error: t.apiInternalError }, 500);
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error('Convex payout retry failed', error);
        return jsonResponse({ error: t.apiInternalError }, 500);
    }
};
