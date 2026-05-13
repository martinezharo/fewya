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
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

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

    const adminClient = createSupabaseAdminClient();

    // 1. Fetch order and verify ownership via shop
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select(`
            id, public_id, status, delivered_at, funds_released_at,
            stripe_payment_intent_id,
            shops!inner(id, owner_id)
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    const shop = one((order as any).shops);
    if (shop?.owner_id !== user.id) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    if (order.status !== 'delivered') {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    if (!order.delivered_at || Date.now() - new Date(order.delivered_at).getTime() < FORTY_EIGHT_HOURS_MS) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    if (order.funds_released_at) {
        // Already confirmed, idempotent success
        return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
    }

    // 2. Confirm the order
    const now = new Date().toISOString();
    const { error: updateError } = await adminClient
        .from('orders')
        .update({ status: 'confirmed', funds_released_at: now })
        .eq('id', orderId);

    if (updateError) {
        console.error('seller-confirm: order update failed', updateError);
        return jsonResponse({ error: strings.sellerOrderConfirmDeliveryError }, 500);
    }

    // 3. Release funds to seller via Stripe
    const { data: orderItems } = await adminClient
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
        .eq('order_id', orderId);

    const payoutItems: CheckoutPricedItem[] = [];
    for (const item of orderItems ?? []) {
        const variant = one((item as any).product_variants);
        const product = one(variant?.products as any);
        const itemShop = one(product?.shops as any);
        const paymentAccount = one(itemShop?.shop_payment_accounts as any);
        if (!itemShop || !paymentAccount?.stripe_account_id) continue;
        payoutItems.push({
            shopId: itemShop.id,
            shopName: itemShop.name,
            shopSlug: itemShop.slug,
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
        console.error('seller-confirm: fund release failed', releaseResult.error);
        return jsonResponse({
            error: 'Entrega confirmada pero el pago falló. Nuestro equipo lo resolverá.',
            orderId: order.id,
        }, 500);
    }

    // 4. Create auto-reviews (silent — non-critical)
    await createAutoReviewsForOrder(orderId);

    return jsonResponse({ success: true, orderId: order.id, publicId: order.public_id }, 200);
};
