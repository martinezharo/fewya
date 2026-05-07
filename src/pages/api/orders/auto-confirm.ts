import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { releaseOrderFunds, type CheckoutPricedItem } from '../../../lib/cart/checkout';

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

    // 1. Auto-confirm all delivered orders past 48h
    const adminClient = createSupabaseAdminClient();
    const { data: confirmedRows, error: autoConfirmError } = await adminClient.rpc(
        'auto_confirm_delivered_orders',
        { p_actor_id: user.id }
    );

    if (autoConfirmError) {
        console.error('auto_confirm_delivered_orders failed', autoConfirmError);
        return jsonResponse({ error: 'Auto-confirm failed' }, 500);
    }

    const autoConfirmed = Array.isArray(confirmedRows) ? confirmedRows : [];
    const released: string[] = [];
    const failed: string[] = [];

    const stripe = getStripeClient();

    // 2. Release funds for each auto-confirmed order
    for (const row of autoConfirmed) {
        const orderId = (row as any).order_id;
        const publicId = (row as any).public_id;

        // Get order details
        const { data: order } = await authClient
            .from('orders')
            .select('id, public_id, stripe_payment_intent_id')
            .eq('id', orderId)
            .single();

        if (!order?.stripe_payment_intent_id) {
            failed.push(publicId);
            continue;
        }

        // Get order items
        const { data: orderItems } = await authClient
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

        if (!orderItems) {
            failed.push(publicId);
            continue;
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

        const releaseResult = await releaseOrderFunds({
            stripe,
            orderId: order.id,
            publicId: order.public_id,
            paymentIntentId: order.stripe_payment_intent_id,
            items: payoutItems,
        });

        if (releaseResult.success) {
            released.push(publicId);
        } else {
            console.error(`auto-confirm fund release failed for ${publicId}`, releaseResult.error);
            failed.push(publicId);
        }
    }

    return jsonResponse({
        success: true,
        autoConfirmed: autoConfirmed.length,
        released,
        failed,
    }, 200);
};
