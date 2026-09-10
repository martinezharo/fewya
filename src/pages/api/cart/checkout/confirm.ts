import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { getStripeClient } from '../../../../lib/payments/stripe';
import { ORDER_STATUS, PAYMENT_STATUS } from '../../../../lib/orders/orderStatus';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ locals, url, request }) => {
    const { t } = locals;
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const convex = createRequestConvexClient(request);
    if (!convex) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    try {
        // The query only returns the caller's own orders, so a guessed or
        // stolen session id reveals nothing and marks nothing as paid.
        const orders = await convex.query(api.orders.listForCheckoutSession, { sessionId });
        if (orders.length === 0) {
            return jsonResponse({ error: t.apiCheckoutConfirmationError }, 404);
        }

        const allPaid = orders.every(
            (order) => order.payment_status === PAYMENT_STATUS.PAID || order.status === ORDER_STATUS.PAID,
        );
        if (allPaid) {
            return jsonResponse({ success: true, orders }, 200);
        }

        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== 'paid') {
            return jsonResponse({ error: t.apiCheckoutSessionPending }, 409);
        }

        const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!paymentIntentId) {
            return jsonResponse({ error: t.apiCheckoutConfirmationError }, 500);
        }

        const marked = await convex.mutation(api.orders.markPaidForCurrentUser, {
            sessionId,
            paymentIntentId,
        });
        return jsonResponse({ success: true, orders: marked.orders }, 200);
    } catch (error) {
        console.error('Checkout confirmation failed', error);
        return jsonResponse({ error: t.apiCheckoutConfirmationError }, 500);
    }
};
