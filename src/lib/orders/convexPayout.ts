import type Stripe from 'stripe';
import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import { releaseOrderFunds } from '../cart/checkout';

/**
 * Everything Stripe needs to pay the sellers of one order. Both the
 * buyer/seller-authorized query and the scheduled job's secret-authorized one
 * return this shape, so the release path below is shared by all of them.
 */
export type PayoutTarget = FunctionReturnType<typeof api.orders.getPayoutOrder>;

/**
 * Releases the funds held for an order and records the outcome on it.
 *
 * The outcome is always written — success or failure — so that the seller's
 * retry endpoint and the scheduled retry job can find orders whose money is
 * still stuck. Writing it needs the deployment secret because the caller has
 * only the buyer's or seller's identity, and neither may set payout state.
 */
export async function releaseAndRecordFunds(options: {
    convex: ConvexHttpClient;
    stripe: Stripe;
    secret: string;
    orderId: string;
    payout: PayoutTarget;
}): Promise<{ success: boolean; error?: string }> {
    const { convex, stripe, secret, orderId, payout } = options;
    if (!payout.stripePaymentIntentId) {
        const error = 'Missing stripe payment intent';
        await convex.mutation(api.orders.recordFundsRelease, { secret, orderId, success: false, error });
        return { success: false, error };
    }

    const result = await releaseOrderFunds({
        stripe,
        orderId: payout.id,
        publicId: payout.publicId,
        paymentIntentId: payout.stripePaymentIntentId,
        items: payout.items,
        labelCostByShop: payout.labelCostByShop,
    });

    await convex.mutation(api.orders.recordFundsRelease, {
        secret,
        orderId,
        success: result.success,
        ...(result.error ? { error: result.error } : {}),
    });

    return result;
}

/**
 * Seeds the 5-star placeholder reviews for the products in a delivered order.
 * A courtesy, not part of the transaction: a failure here is logged and
 * swallowed so it can never fail a confirmation that already moved money.
 */
export async function createAutoReviews(options: {
    convex: ConvexHttpClient;
    secret: string;
    orderId: string;
    comment: string;
}): Promise<void> {
    const { convex, secret, orderId, comment } = options;
    try {
        await convex.mutation(api.reviews.createAutoForOrder, { secret, orderId, comment });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'auto_review.failed_silent',
            orderId,
            error: error instanceof Error ? error.message : String(error),
        }));
    }
}
