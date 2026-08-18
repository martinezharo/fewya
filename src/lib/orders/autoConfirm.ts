import { createSupabaseAdminClient } from '../core/supabase-admin';
import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { getStripeClient } from '../payments/stripe';
import { releaseOrderFunds } from '../cart/checkout';
import { ORDER_STATUS, FUNDS_RELEASE_STATUS } from './orderStatus';
import { fetchAndReleaseFunds } from './payoutFlow';
import { convexOnly } from '../core/env';

const FUND_HOLD_HOURS = 48;

interface AutoConfirmReport {
    autoConfirmed: number;
    released: string[];
    failed: string[];
    retried: number;
    retriedReleased: string[];
    retriedFailed: string[];
}

async function runConvexAutoConfirm(secret: string, stripe: ReturnType<typeof getStripeClient>): Promise<AutoConfirmReport> {
    const empty: AutoConfirmReport = {
        autoConfirmed: 0,
        released: [],
        failed: [],
        retried: 0,
        retriedReleased: [],
        retriedFailed: [],
    };
    const convex = createConvexClient();
    if (!convex) return empty;

    const cutoff = Date.now() - FUND_HOLD_HOURS * 60 * 60 * 1000;
    let eligible;
    try {
        eligible = await convex.query(api.orders.listAutoConfirmCandidates, { secret, cutoff });
    } catch (error) {
        console.error(JSON.stringify({ event: 'auto_confirm.convex_fetch_failed', error: error instanceof Error ? error.message : String(error) }));
        return empty;
    }

    const report: AutoConfirmReport = { ...empty, autoConfirmed: eligible.length };
    await Promise.allSettled(eligible.map(async (candidate) => {
        try {
            const confirmed = await convex.mutation(api.orders.autoConfirmDelivered, {
                secret,
                orderId: candidate.orderId,
                cutoff,
            });
            if (!confirmed.confirmed) return;
            if (!candidate.stripePaymentIntentId) {
                report.failed.push(candidate.publicId);
                await convex.mutation(api.orders.recordFundsRelease, {
                    secret,
                    orderId: candidate.orderId,
                    success: false,
                    error: 'Missing stripe_payment_intent_id',
                });
                return;
            }

            const payout = await convex.query(api.orders.getPayoutOrder, { secret, orderId: candidate.orderId });
            const result = await releaseOrderFunds({
                stripe,
                orderId: payout.id,
                publicId: payout.publicId,
                paymentIntentId: candidate.stripePaymentIntentId,
                items: payout.items,
                labelCostByShop: payout.labelCostByShop,
            });
            await convex.mutation(api.orders.recordFundsRelease, {
                secret,
                orderId: candidate.orderId,
                success: result.success,
                ...(result.success ? {} : { error: result.error ?? 'fund_release_failed' }),
            });
            if (result.success) report.released.push(candidate.publicId);
            else report.failed.push(candidate.publicId);
        } catch (error) {
            report.failed.push(candidate.publicId);
            console.error(JSON.stringify({ event: 'auto_confirm.convex_fund_release_failed', publicId: candidate.publicId, error: error instanceof Error ? error.message : String(error) }));
        }
    }));

    let retries;
    try {
        retries = await convex.query(api.orders.listFailedFundReleaseCandidates, { secret });
    } catch (error) {
        console.error(JSON.stringify({ event: 'auto_confirm.convex_retry_fetch_failed', error: error instanceof Error ? error.message : String(error) }));
        return report;
    }
    report.retried = retries.length;
    await Promise.allSettled(retries.map(async (candidate) => {
        try {
            if (!candidate.stripePaymentIntentId) {
                report.retriedFailed.push(candidate.publicId);
                return;
            }
            const payout = await convex.query(api.orders.getPayoutOrder, { secret, orderId: candidate.orderId });
            const result = await releaseOrderFunds({
                stripe,
                orderId: payout.id,
                publicId: payout.publicId,
                paymentIntentId: candidate.stripePaymentIntentId,
                items: payout.items,
                labelCostByShop: payout.labelCostByShop,
            });
            await convex.mutation(api.orders.recordFundsRelease, {
                secret,
                orderId: candidate.orderId,
                success: result.success,
                ...(result.success ? {} : { error: result.error ?? 'fund_release_failed' }),
            });
            if (result.success) report.retriedReleased.push(candidate.publicId);
            else report.retriedFailed.push(candidate.publicId);
        } catch (error) {
            report.retriedFailed.push(candidate.publicId);
            console.error(JSON.stringify({ event: 'auto_confirm.convex_retry_failed', publicId: candidate.publicId, error: error instanceof Error ? error.message : String(error) }));
        }
    }));

    return report;
}

/**
 * Confirms delivered orders past the 48h hold and releases their funds.
 * Also retries any previously-failed releases (transfer_group keys make the
 * Stripe call idempotent).
 *
 * Shared by the cron `scheduled()` handler and the HTTP endpoint. Reads env via
 * astro:env at call time, so it is safe to invoke from the scheduled context.
 */
export async function runAutoConfirm(convexSecret?: string): Promise<AutoConfirmReport> {
    const stripe = getStripeClient();
    const convexReport = convexSecret ? await runConvexAutoConfirm(convexSecret, stripe) : {
        autoConfirmed: 0,
        released: [],
        failed: [],
        retried: 0,
        retriedReleased: [],
        retriedFailed: [],
    } satisfies AutoConfirmReport;

    if (convexOnly) return convexReport;

    const adminClient = createSupabaseAdminClient();

    // ----- Phase 1: auto-confirm newly-eligible orders -----

    const cutoffTime = new Date(Date.now() - FUND_HOLD_HOURS * 60 * 60 * 1000).toISOString();

    const { data: eligibleOrders, error: fetchError } = await adminClient
        .from('orders')
        .select('id, public_id, stripe_payment_intent_id')
        .eq('status', ORDER_STATUS.DELIVERED)
        .lt('delivered_at', cutoffTime)
        .is('funds_released_at', null);

    if (fetchError) {
        console.error(JSON.stringify({ event: 'auto_confirm.fetch_failed', error: fetchError.message }));
        throw new Error(fetchError.message);
    }

    const released: string[] = [];
    const failed: string[] = [];

    if (eligibleOrders && eligibleOrders.length > 0) {
        const now = new Date().toISOString();
        const confirmedIds = eligibleOrders.map(o => o.id);

        const { error: updateError } = await adminClient
            .from('orders')
            .update({ status: ORDER_STATUS.CONFIRMED, funds_released_at: now })
            .in('id', confirmedIds)
            .eq('status', ORDER_STATUS.DELIVERED);

        if (updateError) {
            console.error(JSON.stringify({ event: 'auto_confirm.update_failed', error: updateError.message }));
            throw new Error(updateError.message);
        }

        await Promise.allSettled(
            eligibleOrders.map(async order => {
                if (!order.stripe_payment_intent_id) {
                    failed.push(order.public_id);
                    return;
                }
                const result = await fetchAndReleaseFunds({
                    adminClient,
                    stripe,
                    order: {
                        id: order.id,
                        public_id: order.public_id,
                        stripe_payment_intent_id: order.stripe_payment_intent_id,
                    },
                });
                if (result.success) {
                    released.push(order.public_id);
                } else {
                    console.error(JSON.stringify({
                        event: 'auto_confirm.fund_release_failed',
                        publicId: order.public_id,
                        error: result.error,
                    }));
                    failed.push(order.public_id);
                }
            }),
        );
    }

    // ----- Phase 2: retry orders whose previous release failed -----
    // These are orders already flipped to a paying status (confirmed) but where
    // the Stripe transfer step blew up (transient issue, deleted account, etc).
    // releaseOrderFunds is idempotent via transfer_group, so retries are safe.

    const { data: retryOrders, error: retryFetchError } = await adminClient
        .from('orders')
        .select('id, public_id, stripe_payment_intent_id')
        .eq('funds_release_status', FUNDS_RELEASE_STATUS.FAILED);

    const retriedReleased: string[] = [];
    const retriedFailed: string[] = [];

    if (retryFetchError) {
        console.error(JSON.stringify({ event: 'auto_confirm.retry_fetch_failed', error: retryFetchError.message }));
    } else if (retryOrders && retryOrders.length > 0) {
        await Promise.allSettled(
            retryOrders.map(async order => {
                if (!order.stripe_payment_intent_id) {
                    retriedFailed.push(order.public_id);
                    return;
                }
                const result = await fetchAndReleaseFunds({
                    adminClient,
                    stripe,
                    order: {
                        id: order.id,
                        public_id: order.public_id,
                        stripe_payment_intent_id: order.stripe_payment_intent_id,
                    },
                });
                if (result.success) {
                    retriedReleased.push(order.public_id);
                } else {
                    retriedFailed.push(order.public_id);
                }
            }),
        );

        if (retriedFailed.length > 0) {
            console.warn(JSON.stringify({ event: 'auto_confirm.retry_still_failing', failed: retriedFailed }));
        }
        if (retriedReleased.length > 0) {
            console.info(JSON.stringify({ event: 'auto_confirm.retry_recovered', released: retriedReleased }));
        }
    }

    if (failed.length > 0) {
        console.warn(JSON.stringify({ event: 'auto_confirm.retry_needed', failed }));
    }

    return {
        autoConfirmed: convexReport.autoConfirmed + (eligibleOrders?.length ?? 0),
        released: [...convexReport.released, ...released],
        failed: [...convexReport.failed, ...failed],
        retried: convexReport.retried + (retryOrders?.length ?? 0),
        retriedReleased: [...convexReport.retriedReleased, ...retriedReleased],
        retriedFailed: [...convexReport.retriedFailed, ...retriedFailed],
    };
}
