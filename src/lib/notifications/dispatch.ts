import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { buildNotification } from './templates';
import { sendEmail } from './resend';
import { sendPush } from './push';
import {
    type NotificationType,
    type NotificationRecipient,
    type NotificationData,
} from './types';

export interface NotifyParams {
    type: NotificationType;
    orderId: string;
    recipient: NotificationRecipient;
    /** Optional overrides merged over data resolved from the order row. */
    dataOverride?: Partial<NotificationData>;
    /** Authorizes the server-side Convex notification path. */
    convexSecret: string;
}

export interface NotifyResult {
    sent: boolean;
    skipped?: boolean;
    reason?: string;
    emailStatus?: string;
    pushStatus?: string;
}

/**
 * Sends a notification (email + push) for an order to either the buyer or the
 * seller. Idempotent: the notification row is claimed in Convex before
 * anything is sent, so each (order, type) is delivered at most once regardless
 * of how many code paths (webhook, poll, cron) reach it.
 */
export async function notify({
    type,
    orderId,
    recipient,
    dataOverride,
    convexSecret,
}: NotifyParams): Promise<NotifyResult> {
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
