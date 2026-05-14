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

export const POST: APIRoute = async ({ request, cookies, locals }) => {
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

    if (autoConfirmed.length === 0) {
        return jsonResponse({ success: true, autoConfirmed: 0, released: [], failed: [] }, 200);
    }

    const confirmedIds = autoConfirmed.map(r => (r as { order_id: string }).order_id);

    // 2. Batch-fetch all order details + items in parallel (replaces N+1 loop)
    const [ordersRes, itemsRes] = await Promise.all([
        adminClient
            .from('orders')
            .select('id, public_id, stripe_payment_intent_id')
            .in('id', confirmedIds),
        adminClient
            .from('order_items')
            .select(`
                order_id,
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
            .in('order_id', confirmedIds),
    ]);

    // Group items by order_id
    const itemsByOrder = new Map<string, typeof itemsRes.data>();
    for (const item of itemsRes.data ?? []) {
        const orderId = (item as { order_id: string }).order_id;
        if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
        itemsByOrder.get(orderId)!.push(item);
    }

    const stripe = getStripeClient();

    // 3. Release funds for all confirmed orders in parallel
    const releaseResults = await Promise.allSettled(
        (ordersRes.data ?? []).map(async order => {
            if (!order.stripe_payment_intent_id) {
                return { publicId: order.public_id, success: false };
            }

            const orderItems = itemsByOrder.get(order.id) ?? [];
            const payoutItems: CheckoutPricedItem[] = [];

            for (const item of orderItems) {
                const variant = one((item as { product_variants: unknown }).product_variants);
                const product = one((variant as { products: unknown } | null)?.products as unknown);
                const shop = one((product as { shops: unknown } | null)?.shops as unknown);
                const paymentAccount = one((shop as { shop_payment_accounts: unknown } | null)?.shop_payment_accounts as unknown);

                if (!shop || !(paymentAccount as { stripe_account_id?: string } | null)?.stripe_account_id) continue;

                payoutItems.push({
                    shopId: (shop as { id: string }).id,
                    shopName: (shop as { name: string }).name,
                    shopSlug: (shop as { slug: string }).slug,
                    stripeAccountId: (paymentAccount as { stripe_account_id: string }).stripe_account_id,
                    quantity: Number((item as { quantity: unknown }).quantity ?? 0),
                    unitPrice: Number((item as { price_at_purchase: unknown }).price_at_purchase ?? 0),
                    shippingCost: Number((variant as { shipping_cost?: unknown } | null)?.shipping_cost ?? 0),
                });
            }

            const result = await releaseOrderFunds({
                stripe,
                orderId: order.id,
                publicId: order.public_id,
                paymentIntentId: order.stripe_payment_intent_id,
                items: payoutItems,
            });

            return { publicId: order.public_id, success: result.success, error: result.error };
        })
    );

    const released: string[] = [];
    const failed: string[] = [];

    for (const result of releaseResults) {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                released.push(result.value.publicId);
            } else {
                console.error(`auto-confirm fund release failed for ${result.value.publicId}`, result.value.error);
                failed.push(result.value.publicId);
            }
        } else {
            console.error('auto-confirm unexpected rejection', result.reason);
        }
    }

    // Use waitUntil to respond fast — transfers already done above but log any cleanup
    const ctx = (locals as { runtime?: { ctx?: { waitUntil: (p: Promise<unknown>) => void } } }).runtime?.ctx;
    if (ctx && failed.length > 0) {
        ctx.waitUntil(
            Promise.resolve(console.warn('auto-confirm: some fund releases failed, retry needed', { failed }))
        );
    }

    return jsonResponse({
        success: true,
        autoConfirmed: autoConfirmed.length,
        released,
        failed,
    }, 200);
};
