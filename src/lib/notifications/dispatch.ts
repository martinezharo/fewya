import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../core/supabase-admin';
import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { buildNotification } from './templates';
import { sendEmail } from './resend';
import { sendPush } from './push';
import {
    type NotificationType,
    type NotificationRecipient,
    type NotificationData,
    type StoredPushSubscription,
} from './types';
import { convexOnly } from '../core/env';

export interface NotifyParams {
    type: NotificationType;
    orderId: string;
    recipient: NotificationRecipient;
    /** Optional overrides merged over data resolved from the order row. */
    dataOverride?: Partial<NotificationData>;
    /** Reuse an existing admin client (e.g. inside the cron scan). */
    client?: SupabaseClient;
    /** Authorizes the server-side Convex notification path for post-cutover orders. */
    convexSecret?: string;
}

export interface NotifyResult {
    sent: boolean;
    skipped?: boolean;
    reason?: string;
    emailStatus?: string;
    pushStatus?: string;
}

interface OrderRow {
    id: string;
    public_id: string;
    buyer_id: string | null;
    buyer_email: string | null;
    pickup_point_name: string | null;
    shops: {
        name: string | null;
        owner_id: string | null;
        contact_email: string | null;
        owner: { email: string | null } | { email: string | null }[] | null;
    } | Array<{
        name: string | null;
        owner_id: string | null;
        contact_email: string | null;
        owner: { email: string | null } | { email: string | null }[] | null;
    }> | null;
    shipments: { tracking_url: string | null }[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

/**
 * Sends a notification (email + push) for an order to either the buyer or the
 * seller. Idempotent: a notification_log row is claimed via ON CONFLICT DO
 * NOTHING before sending, so each (order_id, type) is delivered at most once
 * regardless of how many code paths (webhook, poll, cron) reach it.
 */
export async function notify({
    type,
    orderId,
    recipient,
    dataOverride,
    client,
    convexSecret,
}: NotifyParams): Promise<NotifyResult> {
    if (convexOnly && !(orderId.startsWith('convex:') && convexSecret)) {
        return { sent: false, skipped: true, reason: 'convex_order_required' };
    }
    if (orderId.startsWith('convex:') && convexSecret) {
        return await notifyConvex({ type, orderId, recipient, dataOverride, convexSecret });
    }

    const admin = client ?? createSupabaseAdminClient();

    // --- Resolve the order + recipient ---
    const { data: orderRaw, error: orderErr } = await admin
        .from('orders')
        .select(`
            id,
            public_id,
            buyer_id,
            buyer_email,
            pickup_point_name,
            shops:shop_id ( name, owner_id, contact_email, owner:profiles!shops_owner_id_fkey ( email ) ),
            shipments ( tracking_url )
        `)
        .eq('id', orderId)
        .single();

    if (orderErr || !orderRaw) {
        return { sent: false, skipped: true, reason: 'order_not_found' };
    }

    const order = orderRaw as unknown as OrderRow;
    const shop = first(order.shops);
    const owner = first(shop?.owner);

    let recipientEmail: string | null;
    let recipientUserId: string | null;
    if (recipient === 'buyer') {
        recipientEmail = order.buyer_email;
        recipientUserId = order.buyer_id;
    } else {
        recipientEmail = owner?.email ?? shop?.contact_email ?? null;
        recipientUserId = shop?.owner_id ?? null;
    }

    // --- Claim the dedupe row (atomic) ---
    const { data: claimed, error: claimErr } = await admin
        .from('notification_log')
        .upsert(
            { order_id: orderId, type, recipient_user_id: recipientUserId },
            { onConflict: 'order_id,type', ignoreDuplicates: true },
        )
        .select('id');

    if (claimErr) {
        console.error(JSON.stringify({ event: 'notify.claim_failed', type, orderId, error: claimErr.message }));
        return { sent: false, error: claimErr.message } as NotifyResult;
    }
    if (!claimed || claimed.length === 0) {
        return { sent: false, skipped: true, reason: 'already_sent' };
    }
    const logId = claimed[0].id as string;

    // --- Build content ---
    const data: NotificationData = {
        orderPublicId: order.public_id,
        shopName: shop?.name ?? undefined,
        trackingUrl: first(order.shipments)?.tracking_url ?? null,
        pickupPointName: order.pickup_point_name,
        ...dataOverride,
    };
    const content = buildNotification(type, data);

    // --- Send email ---
    let emailStatus = 'skipped';
    if (recipientEmail) {
        const emailResult = await sendEmail({
            to: recipientEmail,
            subject: content.emailSubject,
            html: content.emailHtml,
        });
        emailStatus = emailResult.sent ? 'sent' : emailResult.skipped ? 'skipped' : `error: ${emailResult.error ?? 'unknown'}`;
    } else {
        emailStatus = 'no_recipient';
    }

    // --- Send push to every subscription of the recipient ---
    let pushStatus = 'skipped';
    if (recipientUserId) {
        const { data: subs } = await admin
            .from('push_subscriptions')
            .select('id, endpoint, p256dh, auth')
            .eq('user_id', recipientUserId);

        const subscriptions = (subs ?? []) as StoredPushSubscription[];
        if (subscriptions.length > 0) {
            let pushed = 0;
            const goneIds: string[] = [];
            await Promise.allSettled(
                subscriptions.map(async (sub) => {
                    const result = await sendPush(sub, {
                        title: content.pushTitle,
                        body: content.pushBody,
                        url: content.url,
                    });
                    if (result.sent) pushed += 1;
                    if (result.gone) goneIds.push(sub.id);
                }),
            );
            if (goneIds.length > 0) {
                await admin.from('push_subscriptions').delete().in('id', goneIds);
            }
            pushStatus = `sent:${pushed}/${subscriptions.length}`;
        } else {
            pushStatus = 'no_subscriptions';
        }
    }

    // --- Record outcome (best-effort) ---
    await admin
        .from('notification_log')
        .update({ email_status: emailStatus, push_status: pushStatus })
        .eq('id', logId);

    return { sent: true, emailStatus, pushStatus };
}

async function notifyConvex({
    type,
    orderId,
    recipient,
    dataOverride,
    convexSecret,
}: Required<Pick<NotifyParams, 'type' | 'orderId' | 'recipient' | 'convexSecret'>> & Pick<NotifyParams, 'dataOverride'>): Promise<NotifyResult> {
    const convex = createConvexClient();
    if (!convex) return { sent: false, skipped: true, reason: 'convex_not_configured' };

    const claimed = await convex.mutation(api.orders.claimNotification, {
        secret: convexSecret,
        orderId,
        type,
        recipient,
    });
    if (!claimed.claimed || !claimed.notificationId || !claimed.orderPublicId) {
        return { sent: false, skipped: true, reason: claimed.reason ?? 'notification_not_claimed' };
    }

    const data: NotificationData = {
        orderPublicId: claimed.orderPublicId,
        shopName: claimed.shopName ?? undefined,
        trackingUrl: claimed.trackingUrl,
        pickupPointName: claimed.pickupPointName,
        ...dataOverride,
    };
    const content = buildNotification(type, data);

    let emailStatus = 'skipped';
    if (claimed.recipientEmail) {
        const emailResult = await sendEmail({
            to: claimed.recipientEmail,
            subject: content.emailSubject,
            html: content.emailHtml,
        });
        emailStatus = emailResult.sent ? 'sent' : emailResult.skipped ? 'skipped' : `error: ${emailResult.error ?? 'unknown'}`;
    } else {
        emailStatus = 'no_recipient';
    }

    let pushStatus = 'skipped';
    if (claimed.recipientUserLegacyId) {
        const subscriptions = await convex.query(api.orders.listNotificationPushSubscriptions, {
            secret: convexSecret,
            userLegacyId: claimed.recipientUserLegacyId,
        });
        if (subscriptions.length > 0) {
            let pushed = 0;
            await Promise.allSettled(subscriptions.map(async (subscription) => {
                const result = await sendPush({
                    id: subscription.legacyId,
                    endpoint: subscription.endpoint,
                    p256dh: subscription.p256dh,
                    auth: subscription.auth,
                }, {
                    title: content.pushTitle,
                    body: content.pushBody,
                    url: content.url,
                });
                if (result.sent) pushed += 1;
                if (result.gone) {
                    await convex.mutation(api.orders.deleteNotificationPushSubscription, {
                        secret: convexSecret,
                        subscriptionLegacyId: subscription.legacyId,
                    });
                }
            }));
            pushStatus = `sent:${pushed}/${subscriptions.length}`;
        } else {
            pushStatus = 'no_subscriptions';
        }
    } else {
        pushStatus = 'no_recipient';
    }

    await convex.mutation(api.orders.completeNotification, {
        secret: convexSecret,
        notificationId: claimed.notificationId,
        emailStatus,
        pushStatus,
    });
    return { sent: true, emailStatus, pushStatus };
}
