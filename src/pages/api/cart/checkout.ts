import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';

interface CheckoutItem {
    variantId: string;
    quantity: number;
    priceAtPurchase: number;
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { items: CheckoutItem[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { items } = body;
    if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: strings.apiCartEmpty }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Validate items
    for (const item of items) {
        if (!item.variantId || !Number.isInteger(item.quantity) || item.quantity < 1 || typeof item.priceAtPurchase !== 'number' || item.priceAtPurchase < 0) {
            return new Response(JSON.stringify({ error: strings.apiInvalidProductData }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    const totalAmount = items.reduce((sum, item) => sum + item.priceAtPurchase * item.quantity, 0);
    const publicId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Create order
    const { data: order, error: orderError } = await authClient
        .from('orders')
        .insert({
            public_id: publicId,
            buyer_id: user.id,
            status: 'pending',
            total_amount: totalAmount,
        })
        .select('id')
        .single();

    if (orderError || !order) {
        return new Response(JSON.stringify({ error: strings.apiOrderCreateError }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Create order items
    const orderItems = items.map(item => ({
        order_id: order.id,
        variant_id: item.variantId,
        quantity: item.quantity,
        price_at_purchase: item.priceAtPurchase,
    }));

    const { error: itemsError } = await authClient
        .from('order_items')
        .insert(orderItems);

    if (itemsError) {
        return new Response(JSON.stringify({ error: strings.apiOrderItemsSaveError }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ orderId: order.id, publicId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
