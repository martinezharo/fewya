import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';
import { getStripeClient } from '../../../lib/stripe';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
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

    // Verify seller owns this order
    const { data: hasAccess } = await authClient.rpc('order_belongs_to_user', {
        p_order_id: orderId,
    });

    if (!hasAccess) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    // Get order with payment intent
    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select('id, public_id, status, stripe_payment_intent_id, total_amount')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    // Only allow cancelling paid/processing orders
    if (!['paid', 'processing'].includes(order.status)) {
        return jsonResponse({ error: 'Este pedido no puede cancelarse' }, 400);
    }

    const stripe = getStripeClient();

    try {
        // Create Stripe refund
        if (order.stripe_payment_intent_id) {
            await stripe.refunds.create({
                payment_intent: order.stripe_payment_intent_id,
                reason: 'requested_by_customer',
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    cancelledBy: user.id,
                },
            });
        }

        // Mark order as cancelled
        const { error: cancelError } = await authClient
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId);

        if (cancelError) {
            console.error('failed to cancel order after refund', cancelError);
            return jsonResponse({ error: strings.sellerOrderRefundError }, 500);
        }

        // Save refund record
        await authClient.from('refunds').insert({
            order_id: orderId,
            amount: order.total_amount,
            currency: 'eur',
            reason: 'seller_cancellation',
            processed_by: user.id,
        });

        return jsonResponse({
            success: true,
            orderId: order.id,
            publicId: order.public_id,
        }, 200);
    } catch (error) {
        console.error('refund failed', error);
        const message = error instanceof Error ? error.message : strings.sellerOrderRefundError;
        return jsonResponse({ error: message }, 500);
    }
};
