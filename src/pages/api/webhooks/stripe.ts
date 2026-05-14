import type { APIRoute } from 'astro';
import { STRIPE_WEBHOOK_SECRET } from 'astro:env/server';
import { getStripeClient } from '../../../lib/payments/stripe';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { securityLog } from '../../../lib/core/security-log';

function ok(): Response {
    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function err(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    if (!STRIPE_WEBHOOK_SECRET) {
        return err('Webhook not configured', 500);
    }

    const sig = request.headers.get('stripe-signature');
    if (!sig) {
        return err('Missing signature', 400);
    }

    // Raw body is required for signature verification — must not parse as JSON first
    const rawBody = await request.text();

    const stripe = getStripeClient();
    let event: import('stripe').Stripe.Event;

    try {
        // constructEventAsync is the Workers-compatible variant (uses Web Crypto, not Node crypto)
        event = await stripe.webhooks.constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        securityLog('security.webhook.invalid_signature', { source: 'stripe', error: msg });
        return err('Invalid signature', 401);
    }

    const adminClient = createSupabaseAdminClient();

    // Idempotency: skip already-processed events (M2)
    const { error: insertConflict } = await adminClient
        .from('processed_webhook_events')
        .insert({ event_id: event.id, source: 'stripe' });

    if (insertConflict) {
        // Unique constraint violation = already processed
        return ok();
    }

    try {
        if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
            await handlePaymentConfirmed(event, adminClient, stripe);
        } else if (event.type === 'charge.refunded') {
            const charge = event.data.object as import('stripe').Stripe.Charge;
            console.info(JSON.stringify({ event: 'stripe.charge.refunded', chargeId: charge.id, amount: charge.amount_refunded }));
        } else if (event.type === 'charge.dispute.created') {
            const dispute = event.data.object as import('stripe').Stripe.Dispute;
            console.warn(JSON.stringify({ event: 'stripe.dispute.created', disputeId: dispute.id, amount: dispute.amount }));
        }
    } catch (e) {
        console.error(JSON.stringify({ event: 'stripe_webhook.handler_error', type: event.type, error: e instanceof Error ? e.message : String(e) }));
        // Return 200 so Stripe doesn't retry — log for manual review
    }

    return ok();
};

async function handlePaymentConfirmed(
    event: import('stripe').Stripe.Event,
    adminClient: ReturnType<typeof createSupabaseAdminClient>,
    _stripe: import('stripe').default,
) {
    let sessionId: string | null = null;
    let paymentIntentId: string | null = null;

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as import('stripe').Stripe.Checkout.Session;
        sessionId = session.id;
        paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
    } else if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as import('stripe').Stripe.PaymentIntent;
        paymentIntentId = pi.id;
    }

    if (!sessionId && !paymentIntentId) return;

    // Find unpaid orders for this session or payment intent
    let query = adminClient
        .from('orders')
        .select('id, buyer_id, stripe_checkout_session_id')
        .neq('payment_status', 'paid');

    if (sessionId) {
        query = query.eq('stripe_checkout_session_id', sessionId);
    } else if (paymentIntentId) {
        query = query.eq('stripe_payment_intent_id', paymentIntentId);
    }

    const { data: orders } = await query;
    if (!orders || orders.length === 0) return;

    // Group by session and buyer — mark_order_paid takes (buyer_id, session_id)
    const sessionGroups = new Map<string, string>(); // sessionId → buyerId
    for (const o of orders) {
        if (o.stripe_checkout_session_id && o.buyer_id) {
            sessionGroups.set(o.stripe_checkout_session_id, o.buyer_id);
        }
    }

    for (const [sid, buyerId] of sessionGroups) {
        const { error } = await adminClient.rpc('mark_order_paid', {
            p_buyer_id: buyerId,
            p_session_id: sid,
            p_payment_intent_id: paymentIntentId,
            p_payment_status: 'paid',
        });

        if (error) {
            console.error(JSON.stringify({ event: 'stripe_webhook.mark_paid_failed', sessionId: sid, error: error.message }));
        }
    }
}
