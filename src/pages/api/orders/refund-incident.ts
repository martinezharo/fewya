import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { CHECKOUT_CURRENCY, toMinorUnits } from '../../../lib/cart/checkout';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
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

    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
        p_order_id: orderId,
    });

    if (!hasAccess) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select('id, public_id, status, stripe_payment_intent_id, total_amount')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    if (order.status !== 'incident') {
        return jsonResponse({ error: strings.sellerIncidentRefundInvalidStatus }, 400);
    }

    const { data: orderItems, error: itemsError } = await authClient
        .from('order_items')
        .select(`
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
        console.error('refund-incident: failed to fetch items', itemsError);
        return jsonResponse({ error: strings.sellerIncidentRefundError }, 500);
    }

    let shippingAmount = 0;
    let sellerStripeAccountId: string | null = null;
    for (const item of orderItems) {
        const variant = one((item as any).product_variants);
        const product = one(variant?.products as any);
        const shop = one(product?.shops as any);
        const paymentAccount = one(shop?.shop_payment_accounts as any);
        const cost = Number(variant?.shipping_cost ?? 0);
        if (cost > shippingAmount) shippingAmount = cost;
        if (!sellerStripeAccountId && paymentAccount?.stripe_account_id) {
            sellerStripeAccountId = paymentAccount.stripe_account_id;
        }
    }

    const totalAmount = Number(order.total_amount);
    const refundAmount = Math.max(0, totalAmount - shippingAmount);

    const stripe = getStripeClient();

    try {
        if (order.stripe_payment_intent_id && refundAmount > 0) {
            await stripe.refunds.create({
                payment_intent: order.stripe_payment_intent_id,
                amount: toMinorUnits(refundAmount),
                reason: 'requested_by_customer',
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    refundedBy: user.id,
                    type: 'incident_refund_excluding_shipping',
                },
            }, {
                idempotencyKey: `incident-refund:${order.id}`,
            });
        }

        if (shippingAmount > 0 && sellerStripeAccountId && order.stripe_payment_intent_id) {
            const paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
            await stripe.transfers.create({
                amount: toMinorUnits(shippingAmount),
                currency: CHECKOUT_CURRENCY,
                destination: sellerStripeAccountId,
                transfer_group: paymentIntent.transfer_group || `order_${order.public_id}`,
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    type: 'incident_shipping_payout',
                },
            }, {
                idempotencyKey: `incident-shipping-transfer:${order.id}`,
            });
        }

        const adminClient = createSupabaseAdminClient();
        const { data: resolvedOrder, error: resolveError } = await adminClient.rpc(
            'resolve_incident_with_refund',
            { p_actor_id: user.id, p_order_id: orderId }
        );

        if (resolveError || !resolvedOrder) {
            console.error('refund-incident: resolve_incident_with_refund failed', resolveError);
            return jsonResponse({ error: strings.sellerIncidentRefundError }, 500);
        }

        await authClient.from('refunds').insert({
            order_id: orderId,
            amount: refundAmount,
            currency: CHECKOUT_CURRENCY,
            reason: 'incident_refund_excluding_shipping',
            processed_by: user.id,
        });

        return jsonResponse({
            success: true,
            orderId: order.id,
            publicId: order.public_id,
            refundedAmount: refundAmount,
            shippingRetained: shippingAmount,
        }, 200);
    } catch (error) {
        console.error('refund-incident failed', error);
        const message = error instanceof Error ? error.message : strings.sellerIncidentRefundError;
        return jsonResponse({ error: message }, 500);
    }
};
