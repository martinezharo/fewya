import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { getStripeClient } from '../../../lib/payments/stripe';
import { toMinorUnits } from '../../../lib/cart/checkout';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

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

    let body: { orderId?: string; cancellationReason?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const cancellationReason = body.cancellationReason?.trim();

    // Verify seller owns this order
    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
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
    if (!([ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING] as string[]).includes(order.status)) {
        return jsonResponse({ error: strings.apiOrderCannotBeCancelled }, 400);
    }

    const stripe = getStripeClient();

    try {
        // Create partial Stripe refund for this shop's order only
        if (order.stripe_payment_intent_id) {
            await stripe.refunds.create({
                payment_intent: order.stripe_payment_intent_id,
                amount: toMinorUnits(order.total_amount),
                reason: 'requested_by_customer',
                metadata: {
                    orderId: order.id,
                    publicId: order.public_id,
                    cancelledBy: user.id,
                },
            });
        }

        // Mark order as cancelled via RPC (bypasses RLS)
        const adminClient = createSupabaseAdminClient();
        const { data: cancelledOrder, error: cancelError } = await adminClient.rpc(
            'cancel_order',
            { p_actor_id: user.id, p_order_id: orderId, p_cancellation_reason: cancellationReason }
        );

        if (cancelError || !cancelledOrder) {
            console.error(JSON.stringify({
                event: 'refund.cancel_failed',
                orderId: order.id,
                publicId: order.public_id,
                error: cancelError?.message,
            }));
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
        console.error(JSON.stringify({
            event: 'refund.failed',
            orderId: order.id,
            publicId: order.public_id,
            error: error instanceof Error ? error.message : String(error),
        }));
        return jsonResponse({ error: strings.sellerOrderRefundError }, 500);
    }
};
