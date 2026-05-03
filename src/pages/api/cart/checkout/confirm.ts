import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';
import { getStripeClient } from '../../../../lib/stripe';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
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

    const { data: orders, error: orderLookupError } = await authClient
        .from('orders')
        .select('id, public_id, status, payment_status, stripe_checkout_session_id')
        .eq('buyer_id', user.id)
        .eq('stripe_checkout_session_id', sessionId);

    if (orderLookupError) {
        console.error('checkout confirmation order lookup failed', orderLookupError);
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
    }

    if (!orders || orders.length === 0) {
        return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 404);
    }

    const allPaid = orders.every((o) => o.payment_status === 'paid' || o.status === 'paid');
    if (allPaid) {
        return jsonResponse({ success: true, orders }, 200);
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

        // Mark ALL orders sharing this session as paid.
        // Funds are held by Fewya until delivery is confirmed.
        // Transfers to sellers happen in /api/orders/release-funds when status becomes 'confirmed'.
        const { error: markPaidError } = await authClient.rpc('mark_order_paid', {
            p_session_id: sessionId,
            p_payment_intent_id: paymentIntentId,
            p_payment_status: session.payment_status,
        });

        if (markPaidError) {
            console.error('checkout confirmation order update failed', markPaidError);
            return jsonResponse({ error: strings.apiCheckoutConfirmationError }, 500);
        }

        return jsonResponse({ success: true, orders }, 200);
    } catch (error) {
        console.error('checkout confirmation failed', error);

        const message = error instanceof Error ? error.message : strings.apiCheckoutConfirmationError;
        const normalizedMessage = message === strings.authMissingStripeEnv ? message : strings.apiCheckoutConfirmationError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }
};
