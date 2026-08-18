import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { createConvexClient } from '../../../lib/core/convex';

import { getStripeClient } from '../../../lib/payments/stripe';
import { CHECKOUT_CURRENCY, toMinorUnits } from '../../../lib/cart/checkout';
import { extractPayoutContext, type JoinedOrderItem } from '../../../lib/orders/orderJoins';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';
import { convexOnly } from '../../../lib/core/env';

type RefundType = 'full' | 'product';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
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

    let body: { orderId?: string; refundType?: RefundType };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    const refundType: RefundType = body.refundType ?? 'product';
    if (!orderId || !['full', 'product'].includes(refundType)) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (orderId.startsWith('convex:')) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return jsonResponse({ error: t.apiUnauthorized }, 401);
        try {
            const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
            if (payout.status !== ORDER_STATUS.DELIVERY_FAILED) {
                return jsonResponse({ error: t.deliveryFailedRefundInvalidStatus }, 400);
            }
            const shippingAmount = payout.items.reduce((max, item) => Math.max(max, item.shippingCost), 0);
            const sellerStripeAccountId = payout.items[0]?.stripeAccountId ?? null;
            const refundAmount = refundType === 'full'
                ? payout.totalAmount
                : Math.max(0, roundMoney(payout.totalAmount - shippingAmount));
            const transferShippingAmount = refundType === 'full' ? 0 : shippingAmount;
            const reasonTag = refundType === 'full' ? 'delivery_failure_full' : 'delivery_failure_product';
            const stripe = getStripeClient();
            const refundCents = toMinorUnits(refundAmount);
            let stripeRefundId: string | undefined;
            if (payout.stripePaymentIntentId && refundAmount > 0) {
                const refund = await stripe.refunds.create({
                    payment_intent: payout.stripePaymentIntentId,
                    amount: refundCents,
                    reason: 'requested_by_customer',
                    metadata: { orderId: payout.id, publicId: payout.publicId, refundedBy: user.id, type: reasonTag },
                }, { idempotencyKey: `delivery-failure-refund-${refundType}-${refundCents}:${payout.id}` });
                stripeRefundId = refund.id;
            }
            if (transferShippingAmount > 0 && sellerStripeAccountId && payout.stripePaymentIntentId) {
                const paymentIntent = await stripe.paymentIntents.retrieve(payout.stripePaymentIntentId);
                await stripe.transfers.create({
                    amount: toMinorUnits(transferShippingAmount),
                    currency: CHECKOUT_CURRENCY,
                    destination: sellerStripeAccountId,
                    transfer_group: paymentIntent.transfer_group || `order_${payout.publicId}`,
                    metadata: { orderId: payout.id, publicId: payout.publicId, type: 'delivery_failure_shipping_payout' },
                }, { idempotencyKey: `delivery-failure-shipping-transfer:${payout.id}` });
            }
            const resolved = await convex.mutation(api.orders.resolveDeliveryFailureWithRefund, {
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
            console.error('Convex delivery failure refund failed', error);
            return jsonResponse({ error: t.deliveryFailedRefundError }, 500);
        }
    }

    if (convexOnly) return jsonResponse({ error: t.deliveryFailedRefundError }, 404);

    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
        p_order_id: orderId,
    });

    if (!hasAccess) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select('id, public_id, status, stripe_payment_intent_id, total_amount')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: t.apiShopNotFound }, 404);
    }

    if (order.status !== ORDER_STATUS.DELIVERY_FAILED) {
        return jsonResponse({ error: t.deliveryFailedRefundInvalidStatus }, 400);
    }

    const { data: orderItems, error: itemsError } = await authClient
        .from('order_items')
        .select(`
            shipping_cost_at_purchase,
            product_variants (
                shipping_cost,
                products (
                    shops (
                        id,
                        shop_payment_accounts (
                            stripe_account_id
                        )
                    )
                )
            )
        `)
        .eq('order_id', orderId);

    if (itemsError || !orderItems) {
        console.error(JSON.stringify({
            event: 'resolve_delivery_failure.fetch_items_failed',
            orderId: order.id,
            publicId: order.public_id,
            error: itemsError?.message,
        }));
        return jsonResponse({ error: t.deliveryFailedRefundError }, 500);
    }

    let shippingAmount = 0;
    let sellerStripeAccountId: string | null = null;
    for (const item of orderItems as JoinedOrderItem[]) {
        const ctx = extractPayoutContext(item);
        if (ctx.shippingCost > shippingAmount) shippingAmount = ctx.shippingCost;
        if (!sellerStripeAccountId && ctx.paymentAccount?.stripe_account_id) {
            sellerStripeAccountId = ctx.paymentAccount.stripe_account_id;
        }
    }

    const totalAmount = Number(order.total_amount);
    let refundAmount = 0;
    let transferShippingAmount = 0;
    let reasonTag: string;

    if (refundType === 'full') {
        refundAmount = totalAmount;
        reasonTag = 'delivery_failure_full';
    } else {
        refundAmount = Math.max(0, roundMoney(totalAmount - shippingAmount));
        transferShippingAmount = shippingAmount;
        reasonTag = 'delivery_failure_product';
    }

    const stripe = getStripeClient();
    const refundCents = toMinorUnits(refundAmount);

    try {
        if (order.stripe_payment_intent_id && refundAmount > 0) {
            await stripe.refunds.create({
                payment_intent: order.stripe_payment_intent_id,
                amount: refundCents,
                reason: 'requested_by_customer',
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    refundedBy: user.id,
                    type: reasonTag,
                },
            }, {
                idempotencyKey: `delivery-failure-refund-${refundType}-${refundCents}:${order.id}`,
            });
        }

        if (transferShippingAmount > 0 && sellerStripeAccountId && order.stripe_payment_intent_id) {
            const paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
            await stripe.transfers.create({
                amount: toMinorUnits(transferShippingAmount),
                currency: CHECKOUT_CURRENCY,
                destination: sellerStripeAccountId,
                transfer_group: paymentIntent.transfer_group || `order_${order.public_id}`,
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    type: 'delivery_failure_shipping_payout',
                },
            }, {
                idempotencyKey: `delivery-failure-shipping-transfer:${order.id}`,
            });
        }

        const adminClient = createSupabaseAdminClient();
        const { data: resolvedOrder, error: resolveError } = await adminClient.rpc(
            'resolve_delivery_failure_with_refund',
            { p_actor_id: user.id, p_order_id: orderId }
        );

        if (resolveError || !resolvedOrder) {
            console.error(JSON.stringify({
                event: 'resolve_delivery_failure.resolve_failed',
                orderId: order.id,
                publicId: order.public_id,
                error: resolveError?.message,
            }));
            return jsonResponse({ error: t.deliveryFailedRefundError }, 500);
        }

        await authClient.from('refunds').insert({
            order_id: orderId,
            amount: refundAmount,
            currency: CHECKOUT_CURRENCY,
            reason: reasonTag,
            processed_by: user.id,
        });

        return jsonResponse({
            success: true,
            orderId: order.id,
            publicId: order.public_id,
            refundType,
            refundedAmount: refundAmount,
            shippingRetained: transferShippingAmount,
        }, 200);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'resolve_delivery_failure.failed',
            orderId: order.id,
            publicId: order.public_id,
            error: error instanceof Error ? error.message : String(error),
        }));
        return jsonResponse({ error: t.deliveryFailedRefundError }, 500);
    }
};
