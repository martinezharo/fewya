import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';

import { getStripeClient } from '../../../lib/payments/stripe';
import { CHECKOUT_CURRENCY, toMinorUnits } from '../../../lib/cart/checkout';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

type RefundType = 'full' | 'product' | 'partial';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);
    if (!user || !convex) return jsonResponse({ error: t.apiUnauthorized }, 401);

    let body: { orderId?: string; refundType?: RefundType; partialAmount?: number };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    const refundType: RefundType = body.refundType ?? 'product';
    if (!orderId || !['full', 'product', 'partial'].includes(refundType)) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    try {
        const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
        if (payout.status !== ORDER_STATUS.INCIDENT) {
            return jsonResponse({ error: t.sellerIncidentRefundInvalidStatus }, 400);
        }
        const shippingAmount = payout.items.reduce((max, item) => Math.max(max, item.shippingCost), 0);
        const sellerStripeAccountId = payout.items[0]?.stripeAccountId ?? null;
        let refundAmount = 0;
        let transferShippingAmount = 0;
        let reasonTag: string;
        if (refundType === 'full') {
            refundAmount = payout.totalAmount;
            reasonTag = 'incident_refund_full';
        } else if (refundType === 'product') {
            refundAmount = Math.max(0, roundMoney(payout.totalAmount - shippingAmount));
            transferShippingAmount = shippingAmount;
            reasonTag = 'incident_refund_product';
        } else {
            const partial = roundMoney(Number(body.partialAmount ?? 0));
            if (!Number.isFinite(partial) || partial <= 0 || partial > payout.totalAmount) {
                return jsonResponse({ error: t.sellerIncidentRefundInvalidPartial }, 400);
            }
            refundAmount = partial;
            reasonTag = 'incident_refund_partial';
        }

        const stripe = getStripeClient();
        const refundCents = toMinorUnits(refundAmount);
        let stripeRefundId: string | undefined;
        if (payout.stripePaymentIntentId && refundAmount > 0) {
            const refund = await stripe.refunds.create({
                payment_intent: payout.stripePaymentIntentId,
                amount: refundCents,
                reason: 'requested_by_customer',
                metadata: { orderId: payout.id, publicId: payout.publicId, refundedBy: user.id, type: reasonTag },
            }, { idempotencyKey: `incident-refund-${refundType}-${refundCents}:${payout.id}` });
            stripeRefundId = refund.id;
        }
        if (transferShippingAmount > 0 && sellerStripeAccountId && payout.stripePaymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(payout.stripePaymentIntentId);
            await stripe.transfers.create({
                amount: toMinorUnits(transferShippingAmount),
                currency: CHECKOUT_CURRENCY,
                destination: sellerStripeAccountId,
                transfer_group: paymentIntent.transfer_group || `order_${payout.publicId}`,
                metadata: { orderId: payout.id, publicId: payout.publicId, type: 'incident_shipping_payout' },
            }, { idempotencyKey: `incident-shipping-transfer:${payout.id}` });
        }
        const resolved = await convex.mutation(api.orders.resolveIncidentWithRefund, {
            orderId,
            amountCents: refundCents,
            currency: CHECKOUT_CURRENCY,
            reason: reasonTag,
            ...(stripeRefundId ? { stripeRefundId } : {}),
        });
        return jsonResponse({
            ...resolved,
            refundType,
            refundedAmount: refundAmount,
            shippingRetained: transferShippingAmount,
        }, 200);
    } catch (error) {
        console.error('Convex incident refund failed', error);
        return jsonResponse({ error: t.sellerIncidentRefundError }, 500);
    }
};
