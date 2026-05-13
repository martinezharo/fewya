import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { releaseOrderFunds, type CheckoutPricedItem } from '../../../lib/cart/checkout';
import { createAutoReviewsForOrder } from '../../../lib/orders/autoReview';

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

    // 1. Confirm delivery in DB
    const adminClient = createSupabaseAdminClient();
    const { data: confirmedOrder, error: confirmError } = await adminClient.rpc(
        'confirm_order_delivery',
        { p_actor_id: user.id, p_order_id: orderId }
    );

    if (confirmError) {
        console.error('confirm_order_delivery failed', confirmError);
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 400);
    }

    const order = Array.isArray(confirmedOrder) ? confirmedOrder[0] : confirmedOrder;
    if (!order?.id) {
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 400);
    }

    // 2. Release funds to sellers
    const { data: orderItems, error: itemsError } = await authClient
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
                            stripe_account_id
                        )
                    )
                )
            )
        `)
        .eq('order_id', order.id);

    if (itemsError || !orderItems) {
        console.error('failed to fetch order items for fund release', itemsError);
        return jsonResponse({ error: 'Delivery confirmed but fund release failed' }, 500);
    }

    const payoutItems: CheckoutPricedItem[] = [];

    for (const item of orderItems) {
        const variant = one((item as any).product_variants);
        const product = one(variant?.products as any);
        const shop = one(product?.shops as any);
        const paymentAccount = one(shop?.shop_payment_accounts as any);

        if (!shop || !paymentAccount?.stripe_account_id) continue;

        payoutItems.push({
            shopId: shop.id,
            shopName: shop.name,
            shopSlug: shop.slug,
            stripeAccountId: paymentAccount.stripe_account_id,
            quantity: Number((item as any).quantity ?? 0),
            unitPrice: Number((item as any).price_at_purchase ?? 0),
            shippingCost: Number(variant?.shipping_cost ?? 0),
        });
    }

    const stripe = getStripeClient();
    const releaseResult = await releaseOrderFunds({
        stripe,
        orderId: order.id,
        publicId: order.public_id,
        paymentIntentId: order.stripe_payment_intent_id,
        items: payoutItems,
    });

    if (!releaseResult.success) {
        console.error('releaseOrderFunds failed after buyer confirmation', releaseResult.error);
        return jsonResponse({
            error: 'Delivery confirmed but fund release failed. Our team will resolve this.',
            orderId: order.id,
        }, 500);
    }

    // Create auto-reviews for products in this order (silent — non-critical)
    await createAutoReviewsForOrder(order.id);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
