import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { createConvexClient } from '../../../lib/core/convex';

import { getStripeClient } from '../../../lib/payments/stripe';
import { FUNDS_RELEASE_STATUS, type FundsReleaseStatus } from '../../../lib/orders/orderStatus';
import { fetchAndReleaseFunds } from '../../../lib/orders/payoutFlow';
import { releaseOrderFunds } from '../../../lib/cart/checkout';
import { convexOnly } from '../../../lib/core/env';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request, cookies  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (orderId.startsWith('convex:')) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex || !CONVEX_WEBHOOK_SECRET) return jsonResponse({ error: t.apiUnauthorized }, 401);
        try {
            const payout = await convex.query(api.orders.getPayoutContextForCurrentUser, { orderId });
            if (payout.fundsReleaseStatus !== FUNDS_RELEASE_STATUS.FAILED || !payout.stripePaymentIntentId) {
                return jsonResponse({ error: t.apiInvalidBody }, 400);
            }
            const stripe = getStripeClient();
            const result = await releaseOrderFunds({
                stripe,
                orderId: payout.id,
                publicId: payout.publicId,
                paymentIntentId: payout.stripePaymentIntentId,
                items: payout.items,
                labelCostByShop: payout.labelCostByShop,
            });
            await convex.mutation(api.orders.recordFundsRelease, {
                secret: CONVEX_WEBHOOK_SECRET,
                orderId,
                success: result.success,
                ...(result.error ? { error: result.error } : {}),
            });
            if (!result.success) return jsonResponse({ error: t.apiInternalError }, 500);
            return jsonResponse({ success: true }, 200);
        } catch (error) {
            console.error('Convex payout retry failed', error);
            return jsonResponse({ error: t.apiInternalError }, 500);
        }
    }

    if (convexOnly) return jsonResponse({ error: t.apiInvalidBody }, 404);

    const adminClient = createSupabaseAdminClient();

    // Verify the seller owns this order's shop
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select(`
            id, public_id, stripe_payment_intent_id, funds_release_status,
            shops!inner(id, owner_id)
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    type OrderWithShop = {
        id: string;
        public_id: string;
        stripe_payment_intent_id: string | null;
        funds_release_status: FundsReleaseStatus;
        shops: { id: string; owner_id: string | null } | { id: string; owner_id: string | null }[] | null;
    };
    const typedOrder = order as unknown as OrderWithShop;
    const shop = Array.isArray(typedOrder.shops) ? typedOrder.shops[0] : typedOrder.shops;
    if (shop?.owner_id !== user.id) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    if (typedOrder.funds_release_status !== FUNDS_RELEASE_STATUS.FAILED) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (!typedOrder.stripe_payment_intent_id) {
        return jsonResponse({ error: t.apiInternalError }, 400);
    }

    const stripe = getStripeClient();
    const releaseResult = await fetchAndReleaseFunds({
        adminClient,
        stripe,
        order: {
            id: typedOrder.id,
            public_id: typedOrder.public_id,
            stripe_payment_intent_id: typedOrder.stripe_payment_intent_id,
        },
    });

    if (!releaseResult.success) {
        return jsonResponse({ error: t.apiInternalError }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
