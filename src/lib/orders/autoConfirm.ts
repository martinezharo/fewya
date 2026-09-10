import type { ConvexHttpClient } from 'convex/browser';
import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { getStripeClient } from '../payments/stripe';
import { releaseAndRecordFunds } from './convexPayout';

const FUND_HOLD_HOURS = 48;

interface AutoConfirmReport {
    autoConfirmed: number;
    released: string[];
    failed: string[];
    retried: number;
    retriedReleased: string[];
    retriedFailed: string[];
}

function emptyReport(): AutoConfirmReport {
    return {
        autoConfirmed: 0,
        released: [],
        failed: [],
        retried: 0,
        retriedReleased: [],
        retriedFailed: [],
    };
}

interface ReleaseCandidate {
    orderId: string;
    publicId: string;
    stripePaymentIntentId: string | null;
}

/**
 * Releases one candidate's funds. Returns false when the money did not move,
 * so the caller can report it for the next run — the transfer_group key makes
 * a later retry of the same order idempotent on Stripe's side.
 */
async function releaseCandidate(
    convex: ConvexHttpClient,
    stripe: ReturnType<typeof getStripeClient>,
    secret: string,
    candidate: ReleaseCandidate,
): Promise<boolean> {
    if (!candidate.stripePaymentIntentId) {
        await convex.mutation(api.orders.recordFundsRelease, {
            secret,
            orderId: candidate.orderId,
            success: false,
            error: 'Missing stripe payment intent',
        });
        return false;
    }

    const payout = await convex.query(api.orders.getPayoutOrder, { secret, orderId: candidate.orderId });
    const result = await releaseAndRecordFunds({
        convex,
        stripe,
        secret,
        orderId: candidate.orderId,
        payout,
    });
    return result.success;
}

/**
 * Confirms delivered orders past the 48h hold and releases their funds.
 * Also retries any previously-failed releases.
 *
 * Shared by the cron `scheduled()` handler and the HTTP endpoint. Reads env via
 * astro:env at call time, so it is safe to invoke from the scheduled context.
 */
export async function runAutoConfirm(convexSecret?: string): Promise<AutoConfirmReport> {
    const report = emptyReport();
    const convex = convexSecret ? createConvexClient() : null;
    if (!convex || !convexSecret) return report;

    const stripe = getStripeClient();
    const cutoff = Date.now() - FUND_HOLD_HOURS * 60 * 60 * 1000;

    // ----- Phase 1: auto-confirm newly-eligible orders -----
    let eligible: ReleaseCandidate[];
    try {
        eligible = await convex.query(api.orders.listAutoConfirmCandidates, { secret: convexSecret, cutoff });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'auto_confirm.fetch_failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return report;
    }

    report.autoConfirmed = eligible.length;
    await Promise.allSettled(eligible.map(async (candidate) => {
        try {
            const confirmed = await convex.mutation(api.orders.autoConfirmDelivered, {
                secret: convexSecret,
                orderId: candidate.orderId,
                cutoff,
            });
            if (!confirmed.confirmed) return;

            if (await releaseCandidate(convex, stripe, convexSecret, candidate)) {
                report.released.push(candidate.publicId);
            } else {
                report.failed.push(candidate.publicId);
            }
        } catch (error) {
            report.failed.push(candidate.publicId);
            console.error(JSON.stringify({
                event: 'auto_confirm.fund_release_failed',
                publicId: candidate.publicId,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }));

    // ----- Phase 2: retry orders whose previous release failed -----
    // These are orders already flipped to a paying status (confirmed) but where
    // the Stripe transfer step blew up (transient issue, deleted account, etc).
    let retries: ReleaseCandidate[];
    try {
        retries = await convex.query(api.orders.listFailedFundReleaseCandidates, { secret: convexSecret });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'auto_confirm.retry_fetch_failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return report;
    }

    report.retried = retries.length;
    await Promise.allSettled(retries.map(async (candidate) => {
        try {
            if (await releaseCandidate(convex, stripe, convexSecret, candidate)) {
                report.retriedReleased.push(candidate.publicId);
            } else {
                report.retriedFailed.push(candidate.publicId);
            }
        } catch (error) {
            report.retriedFailed.push(candidate.publicId);
            console.error(JSON.stringify({
                event: 'auto_confirm.retry_failed',
                publicId: candidate.publicId,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }));

    if (report.failed.length > 0) {
        console.warn(JSON.stringify({ event: 'auto_confirm.retry_needed', failed: report.failed }));
    }
    if (report.retriedFailed.length > 0) {
        console.warn(JSON.stringify({ event: 'auto_confirm.retry_still_failing', failed: report.retriedFailed }));
    }
    if (report.retriedReleased.length > 0) {
        console.info(JSON.stringify({ event: 'auto_confirm.retry_recovered', released: report.retriedReleased }));
    }

    return report;
}
