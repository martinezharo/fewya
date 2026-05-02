import type { APIRoute } from 'astro';
import {
    buildShopPayouts,
    CHECKOUT_CURRENCY,
    type CheckoutPricedItem,
    toMinorUnits,
} from '../../../../lib/checkout';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';
import { getStripeClient } from '../../../../lib/stripe';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

export const GET: APIRoute = async ({ url, request, cookies }) => {
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    const { data: order, error: orderLookupError } = await authClient
        .from('orders')
        .select('id, public_id, status, payment_status, stripe_checkout_session_id')
        .eq('buyer_id', user.id)
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle();

    if (orderLookupError) {
        console.error('checkout confirmation order lookup failed', orderLookupError);
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
    }

    if (!order) {
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 404);
    }

    if (order.payment_status === 'paid' || order.status === 'paid') {
        return jsonResponse({ success: true, publicId: order.public_id }, 200);
    }

    const stripe = getStripeClient();

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid') {
            return jsonResponse({ error: strings.apiCheckoutSessionPending }, 409);
        }

        const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!paymentIntentId) {
            return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge'],
        });

        const latestCharge = typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id;

        if (!latestCharge) {
            return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
        }

        const { data: orderItems, error: orderItemsError } = await authClient
            .from('order_items')
            .select(`
                quantity,
                price_at_purchase,
                product_variants (
                    shipping_cost,
                    products (
                        shops (
                            id,
                            name,
                            slug,
                            shop_payment_accounts (
                                stripe_account_id,
                                charges_enabled,
                                payouts_enabled,
                                details_submitted
                            )
                        )
                    )
                )
            `)
            .eq('order_id', order.id);

        if (orderItemsError) {
            console.error('checkout confirmation items lookup failed', orderItemsError);
            return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
        }

        const payoutItems: CheckoutPricedItem[] = [];

        for (const item of orderItems ?? []) {
            const variant = one((item as any).product_variants);
            const product = one(variant?.products as any);
            const shop = one(product?.shops as any);
            const paymentAccount = one(shop?.shop_payment_accounts as any);

            if (!shop || !paymentAccount?.stripe_account_id) {
                return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
            }

            payoutItems.push({
                shopId: shop.id,
                shopName: shop.name,
                shopSlug: shop.slug,
                stripeAccountId: paymentAccount.stripe_account_id,
                quantity: Number((item as any).quantity ?? 0),
                unitPrice: Number((item as any).price_at_purchase ?? 0),
                shippingCost: Number((item as any).product_variants?.shipping_cost ?? 0),
            });
        }

        const payoutBreakdown = buildShopPayouts(payoutItems);

        for (const payout of payoutBreakdown) {
            await stripe.transfers.create({
                amount: toMinorUnits(payout.total),
                currency: CHECKOUT_CURRENCY,
                destination: payout.stripeAccountId,
                source_transaction: latestCharge,
                transfer_group: paymentIntent.transfer_group || `order_${order.public_id}`,
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    shopId: payout.shopId,
                },
            }, {
                idempotencyKey: `order-transfer:${order.id}:${payout.shopId}`,
            });
        }

        const { error: markPaidError } = await authClient.rpc('mark_order_paid', {
            p_order_id: order.id,
            p_session_id: sessionId,
            p_payment_intent_id: paymentIntentId,
            p_payment_status: session.payment_status,
        });

        if (markPaidError) {
            console.error('checkout confirmation order update failed', markPaidError);
            return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
        }

        return jsonResponse({ success: true, publicId: order.public_id }, 200);
    } catch (error) {
        console.error('checkout confirmation failed', error);

        const message = error instanceof Error ? error.message : strings.apiCheckoutConfirmationError;
        const normalizedMessage = message === strings.authMissingStripeEnv ? message : strings.apiCheckoutConfirmationError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }
};