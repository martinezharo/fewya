import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';

import { getStripeClient } from '../../../lib/payments/stripe';
import { toMinorUnits } from '../../../lib/cart/checkout';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);
    if (!user || !convex) return jsonResponse({ error: t.apiUnauthorized }, 401);

    let body: { orderId?: string; cancellationReason?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const cancellationReason = body.cancellationReason?.trim();

    try {
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        if (!([ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING] as string[]).includes(payout.status)) {
            return jsonResponse({ error: t.apiOrderCannotBeCancelled }, 400);
        }
        const stripe = getStripeClient();
        let stripeRefundId: string | undefined;
        if (payout.stripePaymentIntentId && payout.totalAmount > 0) {
            const refund = await stripe.refunds.create({
                payment_intent: payout.stripePaymentIntentId,
                amount: toMinorUnits(payout.totalAmount),
                reason: 'requested_by_customer',
                metadata: { orderId: payout.id, publicId: payout.publicId, cancelledBy: user.id },
            }, { idempotencyKey: `cancel-refund:${payout.id}` });
            stripeRefundId = refund.id;
        }
        const cancelled = await convex.mutation(api.orders.cancelForSeller, {
            orderId,
            ...(cancellationReason ? { cancellationReason } : {}),
            refundAmountCents: toMinorUnits(payout.totalAmount),
            currency: 'eur',
            ...(stripeRefundId ? { stripeRefundId } : {}),
        });
        return jsonResponse(cancelled, 200);
    } catch (error) {
        console.error('Convex seller cancellation failed', error);
        return jsonResponse({ error: t.sellerOrderRefundError }, 500);
    }
};
