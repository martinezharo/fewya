import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import { getStripeWebhookSecret } from '../../../lib/core/env';
import { getStripeClient } from '../../../lib/payments/stripe';
import { createConvexClient } from '../../../lib/core/convex';
import { securityLog } from '../../../lib/core/security-log';
import { notify } from '../../../lib/notifications/dispatch';
import { NOTIFICATION_TYPE } from '../../../lib/notifications/types';

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
    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret) {
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
        event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        securityLog('security.webhook.invalid_signature', { source: 'stripe', error: msg });
        return err('Invalid signature', 401);
    }

    const convexSecret = CONVEX_WEBHOOK_SECRET;
    const convex = convexSecret ? createConvexClient() : null;
    if (!convex || !convexSecret) {
        // Without the deployment secret nothing can be committed. Fail loudly
        // so Stripe retries instead of dropping a paid order.
        console.error(JSON.stringify({ event: 'stripe_webhook.not_configured', type: event.type }));
        return err('handler not configured', 500);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
        let sessionId: string | undefined;
        let paymentIntentId: string | undefined;
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as import('stripe').Stripe.Checkout.Session;
            sessionId = session.id;
            paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        } else {
            paymentIntentId = (event.data.object as import('stripe').Stripe.PaymentIntent).id;
        }

        try {
            const result = await convex.mutation(api.orders.processStripePayment, {
                secret: convexSecret,
                eventId: event.id,
                ...(sessionId ? { sessionId } : {}),
                ...(paymentIntentId ? { paymentIntentId } : {}),
            });

            if (result.handled) {
                if (result.requiresRefund) {
                    await refundStripePayment({
                        stripe,
                        sessionId: sessionId ?? 'unknown',
                        paymentIntentId: paymentIntentId ?? null,
                        failureReason: result.failureReason ?? 'payment_confirmation_failed',
                    });
                } else {
                    // Convex has already committed payment and stock in the same
                    // transaction. Delivery of the seller sale notification is
                    // deliberately best-effort and deduplicated in Convex so a
                    // Stripe retry cannot send it twice.
                    await Promise.allSettled(result.orders.map((order) => notify({
                        type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
                        orderId: order.id,
                        recipient: 'seller',
                        convexSecret,
                    })));
                }
                return ok();
            }
        } catch (e) {
            // A Convex transport/deployment failure must be retried by Stripe;
            // acknowledging would leave the order pending forever.
            console.error(JSON.stringify({
                event: 'stripe_webhook.handler_error',
                type: event.type,
                error: e instanceof Error ? e.message : String(e),
            }));
            return err('handler error', 500);
        }
    }

    // An event that matches no order (a legacy reference, or a Connect event we
    // do not act on) is acknowledged rather than retried forever.
    return ok();
};

async function refundStripePayment({
    stripe,
    sessionId,
    paymentIntentId,
    failureReason,
}: {
    stripe: import('stripe').default;
    sessionId: string;
    paymentIntentId: string | null;
    failureReason: string;
}) {
    if (!paymentIntentId) {
        console.error(JSON.stringify({ event: 'stripe_webhook.refund_skipped_no_payment_intent', sessionId }));
        return;
    }

    try {
        await stripe.refunds.create({
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: { sessionId, reason: failureReason },
        }, {
            // Keyed on the session, not the event id, so a Stripe webhook retry
            // of the same event (or a retry of a different event for the same
            // session) can't trigger a second refund.
            idempotencyKey: `mark-paid-failure-refund:${sessionId}`,
        });
    } catch (e) {
        console.error(JSON.stringify({
            event: 'stripe_webhook.refund_failed',
            sessionId,
            paymentIntentId,
            error: e instanceof Error ? e.message : String(e),
        }));
    }
}
