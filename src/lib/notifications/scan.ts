import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { notify } from './dispatch';
import { NOTIFICATION_TYPE } from './types';
import { workingDaysSince } from './workingDays';

export interface NotificationScanReport {
    outForDelivery: number;
    pickupReady: number;
    pickupReminder: number;
    labelReminder: number;
    shipReminder: number;
}

// Only look at tracking events from the recent past — older ones are already
// handled and notification_log dedupes anyway; this just bounds the scan.
const TRACKING_WINDOW_DAYS = 10;
// Reminder thresholds (see plan): label = calendar days, ship/pickup = working days.
const LABEL_REMINDER_CALENDAR_DAYS = 3;
const SHIP_REMINDER_WORKING_DAYS = 3;
const PICKUP_REMINDER_WORKING_DAYS = 3;

async function notifyOrderIds(
    orderIds: Iterable<string>,
    type: (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE],
    recipient: 'buyer' | 'seller',
    convexSecret: string,
): Promise<number> {
    let sent = 0;
    await Promise.allSettled(
        [...orderIds].map(async (orderId) => {
            const r = await notify({ type, orderId, recipient, convexSecret });
            if (r.sent) sent += 1;
        }),
    );
    return sent;
}

/**
 * Scans for shipping sub-statuses and time-based reminders and dispatches any
 * notifications not yet sent. Designed to run from the 4-hour cron alongside
 * syncAllTracking/runAutoConfirm. Every send is idempotent: Convex claims the
 * notification row before anything leaves the Worker.
 */
export async function runNotificationScan(convexSecret?: string): Promise<NotificationScanReport> {
    const report: NotificationScanReport = { outForDelivery: 0, pickupReady: 0, pickupReminder: 0, labelReminder: 0, shipReminder: 0 };
    const convex = convexSecret ? createConvexClient() : null;
    if (convex && convexSecret) {
        try {
            const candidates = await convex.query(api.orders.notificationScanCandidates, {
                secret: convexSecret,
                trackingCutoff: Date.now() - TRACKING_WINDOW_DAYS * 86400000,
                labelCutoff: Date.now() - LABEL_REMINDER_CALENDAR_DAYS * 86400000,
            });
            Object.assign(report, {
                outForDelivery: await notifyOrderIds(candidates.outForDelivery, NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY, 'buyer', convexSecret),
                pickupReady: await notifyOrderIds(candidates.pickupReady, NOTIFICATION_TYPE.BUYER_PICKUP_READY, 'buyer', convexSecret),
                pickupReminder: await notifyOrderIds(
                    candidates.pickupReminder
                        .filter((entry) => workingDaysSince(new Date(entry.createdAt)) >= PICKUP_REMINDER_WORKING_DAYS)
                        .map((entry) => entry.orderId),
                    NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER,
                    'buyer',
                    convexSecret,
                ),
                labelReminder: await notifyOrderIds(candidates.labelReminder, NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, 'seller', convexSecret),
                shipReminder: await notifyOrderIds(
                    candidates.shipReminder
                        .filter((entry) => workingDaysSince(new Date(entry.paidAt)) >= SHIP_REMINDER_WORKING_DAYS)
                        .map((entry) => entry.orderId),
                    NOTIFICATION_TYPE.SELLER_SHIP_REMINDER,
                    'seller',
                    convexSecret,
                ),
            });
        } catch (error) {
            console.error(JSON.stringify({ event: 'notif_scan.fetch_failed', error: error instanceof Error ? error.message : String(error) }));
        }
    }

    return report;
}
