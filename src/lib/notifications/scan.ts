import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../core/supabase-admin';
import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { ORDER_STATUS, DELIVERY_TYPE } from '../orders/orderStatus';
import { notify } from './dispatch';
import { NOTIFICATION_TYPE } from './types';
import { workingDaysSince } from './workingDays';
import { convexOnly } from '../core/env';

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

// Sendcloud status messages that mean "waiting at a service point for the buyer".
const PICKUP_READY_PATTERNS = [
    'ready to be picked up',
    'delivered to service point',
    'available for pickup',
    'awaiting customer pickup',
    'ready for pickup',
];

interface TrackingOrderRow {
    shipments: {
        order_id: string | null;
        orders: { delivery_type: string | null } | { delivery_type: string | null }[] | null;
    } | null;
}

function firstOrder(value: TrackingOrderRow['shipments']): { order_id: string | null; deliveryType: string | null } {
    const s = value;
    if (!s) return { order_id: null, deliveryType: null };
    const o = Array.isArray(s.orders) ? s.orders[0] : s.orders;
    return { order_id: s.order_id, deliveryType: o?.delivery_type ?? null };
}

async function notifyOrderIds(
    client: SupabaseClient | undefined,
    orderIds: Iterable<string>,
    type: (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE],
    recipient: 'buyer' | 'seller',
    convexSecret?: string,
): Promise<number> {
    let sent = 0;
    await Promise.allSettled(
        [...orderIds].map(async (orderId) => {
            const r = await notify({ type, orderId, recipient, client, convexSecret });
            if (r.sent) sent += 1;
        }),
    );
    return sent;
}

/**
 * Scans for shipping sub-statuses and time-based reminders and dispatches any
 * notifications not yet sent. Designed to run from the 4-hour cron alongside
 * syncAllTracking/runAutoConfirm. All sends are idempotent via notification_log.
 */
export async function runNotificationScan(convexSecret?: string): Promise<NotificationScanReport> {
    const client = convexOnly ? undefined : createSupabaseAdminClient();
    const trackingCutoff = new Date(Date.now() - TRACKING_WINDOW_DAYS * 86400000).toISOString();

    let convexReport: NotificationScanReport = { outForDelivery: 0, pickupReady: 0, pickupReminder: 0, labelReminder: 0, shipReminder: 0 };
    const convex = convexSecret ? createConvexClient() : null;
    if (convex && convexSecret) {
        try {
            const candidates = await convex.query(api.orders.notificationScanCandidates, {
                secret: convexSecret,
                trackingCutoff: Date.now() - TRACKING_WINDOW_DAYS * 86400000,
                labelCutoff: Date.now() - LABEL_REMINDER_CALENDAR_DAYS * 86400000,
            });
            convexReport = {
                outForDelivery: await notifyOrderIds(undefined, candidates.outForDelivery, NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY, 'buyer', convexSecret),
                pickupReady: await notifyOrderIds(undefined, candidates.pickupReady, NOTIFICATION_TYPE.BUYER_PICKUP_READY, 'buyer', convexSecret),
                pickupReminder: await notifyOrderIds(
                    undefined,
                    candidates.pickupReminder
                        .filter((entry) => workingDaysSince(new Date(entry.createdAt)) >= PICKUP_REMINDER_WORKING_DAYS)
                        .map((entry) => entry.orderId),
                    NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER,
                    'buyer',
                    convexSecret,
                ),
                labelReminder: await notifyOrderIds(undefined, candidates.labelReminder, NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, 'seller', convexSecret),
                shipReminder: await notifyOrderIds(
                    undefined,
                    candidates.shipReminder
                        .filter((entry) => workingDaysSince(new Date(entry.paidAt)) >= SHIP_REMINDER_WORKING_DAYS)
                        .map((entry) => entry.orderId),
                    NOTIFICATION_TYPE.SELLER_SHIP_REMINDER,
                    'seller',
                    convexSecret,
                ),
            };
        } catch (error) {
            console.error(JSON.stringify({ event: 'notif_scan.convex_fetch_failed', error: error instanceof Error ? error.message : String(error) }));
        }
    }

    // The isolated test Worker has no legacy scan path. Its Convex report is
    // complete above; do not open the production Supabase project.
    if (convexOnly) return convexReport;
    if (!client) throw new Error('Supabase notification client unavailable');

    // ---- 1. Out for delivery (buyer) ----
    let outForDelivery = 0;
    {
        const { data, error } = await client
            .from('shipment_tracking')
            .select('shipments!inner ( order_id, orders!inner ( delivery_type ) )')
            .ilike('status', '%out for delivery%')
            .gte('created_at', trackingCutoff);
        if (error) {
            console.error(JSON.stringify({ event: 'notif_scan.out_for_delivery_failed', error: error.message }));
        } else {
            const ids = new Set<string>();
            for (const row of (data ?? []) as unknown as TrackingOrderRow[]) {
                const { order_id } = firstOrder(row.shipments);
                if (order_id) ids.add(order_id);
            }
            outForDelivery = await notifyOrderIds(client, ids, NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY, 'buyer');
        }
    }

    // ---- 2. Ready to pick up (buyer, pickup-point orders) ----
    let pickupReady = 0;
    {
        const orFilter = PICKUP_READY_PATTERNS.map((p) => `status.ilike.%${p}%`).join(',');
        const { data, error } = await client
            .from('shipment_tracking')
            .select('shipments!inner ( order_id, orders!inner ( delivery_type ) )')
            .or(orFilter)
            .gte('created_at', trackingCutoff);
        if (error) {
            console.error(JSON.stringify({ event: 'notif_scan.pickup_ready_failed', error: error.message }));
        } else {
            const ids = new Set<string>();
            for (const row of (data ?? []) as unknown as TrackingOrderRow[]) {
                const { order_id, deliveryType } = firstOrder(row.shipments);
                if (order_id && deliveryType === DELIVERY_TYPE.PICKUP_POINT) ids.add(order_id);
            }
            pickupReady = await notifyOrderIds(client, ids, NOTIFICATION_TYPE.BUYER_PICKUP_READY, 'buyer');
        }
    }

    // ---- 3. Pickup reminder (buyer) ----
    // Orders still 'shipped' + pickup-point, where the pickup-ready notice was
    // sent >= N working days ago and no reminder has been sent yet.
    let pickupReminder = 0;
    {
        const { data, error } = await client
            .from('notification_log')
            .select('order_id, created_at, orders!inner ( status, delivery_type )')
            .eq('type', NOTIFICATION_TYPE.BUYER_PICKUP_READY);
        if (error) {
            console.error(JSON.stringify({ event: 'notif_scan.pickup_reminder_failed', error: error.message }));
        } else {
            const ids = new Set<string>();
            for (const row of (data ?? []) as unknown as Array<{
                order_id: string | null;
                created_at: string;
                orders: { status: string; delivery_type: string } | { status: string; delivery_type: string }[] | null;
            }>) {
                const o = Array.isArray(row.orders) ? row.orders[0] : row.orders;
                if (!row.order_id || !o) continue;
                if (o.status !== ORDER_STATUS.SHIPPED || o.delivery_type !== DELIVERY_TYPE.PICKUP_POINT) continue;
                if (workingDaysSince(row.created_at) >= PICKUP_REMINDER_WORKING_DAYS) ids.add(row.order_id);
            }
            pickupReminder = await notifyOrderIds(client, ids, NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER, 'buyer');
        }
    }

    // ---- 4. Seller label reminder ----
    // status 'paid' means no label was bought yet (buying one flips to 'processing').
    let labelReminder = 0;
    {
        const cutoff = new Date(Date.now() - LABEL_REMINDER_CALENDAR_DAYS * 86400000).toISOString();
        const { data, error } = await client
            .from('orders')
            .select('id')
            .eq('status', ORDER_STATUS.PAID)
            .lt('paid_at', cutoff)
            .not('paid_at', 'is', null);
        if (error) {
            console.error(JSON.stringify({ event: 'notif_scan.label_reminder_failed', error: error.message }));
        } else {
            const ids = (data ?? []).map((o) => o.id as string);
            labelReminder = await notifyOrderIds(client, ids, NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, 'seller');
        }
    }

    // ---- 5. Seller ship reminder ----
    // status 'processing' = label bought but carrier hasn't picked it up yet.
    let shipReminder = 0;
    {
        const { data, error } = await client
            .from('orders')
            .select('id, paid_at')
            .eq('status', ORDER_STATUS.PROCESSING)
            .not('paid_at', 'is', null);
        if (error) {
            console.error(JSON.stringify({ event: 'notif_scan.ship_reminder_failed', error: error.message }));
        } else {
            const ids = (data ?? [])
                .filter((o) => o.paid_at && workingDaysSince(o.paid_at as string) >= SHIP_REMINDER_WORKING_DAYS)
                .map((o) => o.id as string);
            shipReminder = await notifyOrderIds(client, ids, NOTIFICATION_TYPE.SELLER_SHIP_REMINDER, 'seller');
        }
    }

    return {
        outForDelivery: convexReport.outForDelivery + outForDelivery,
        pickupReady: convexReport.pickupReady + pickupReady,
        pickupReminder: convexReport.pickupReminder + pickupReminder,
        labelReminder: convexReport.labelReminder + labelReminder,
        shipReminder: convexReport.shipReminder + shipReminder,
    };
}
