import { es as fallbackEs, type Strings } from '../core/i18n';
import { getAppBaseUrl } from '../core/env';
import { NOTIFICATION_TYPE, type NotificationType, type NotificationData } from './types';

export interface BuiltNotification {
    emailSubject: string;
    emailHtml: string;
    pushTitle: string;
    pushBody: string;
    url: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
    return Object.entries(vars).reduce(
        (acc, [key, value]) => acc.split(`{${key}}`).join(value),
        template,
    );
}

/** Buyer order detail page. */
function buyerOrderUrl(orderPublicId: string): string {
    return `${getAppBaseUrl()}/me/orders?order=${encodeURIComponent(orderPublicId)}`;
}

/** Seller order management page. */
function sellerOrderUrl(orderPublicId: string): string {
    return `${getAppBaseUrl()}/sell/orders?order=${encodeURIComponent(orderPublicId)}`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

interface EmailShellParams {
    heading: string;
    body: string;
    primaryCtaLabel: string;
    primaryCtaUrl: string;
    secondaryCtaLabel?: string;
    secondaryCtaUrl?: string | null;
    footer: string;
}

/**
 * Minimal, theme-agnostic HTML shell. Inline styles only (email clients ignore
 * <style>/external CSS and most do not honour prefers-color-scheme reliably), so
 * we use neutral colours that read well on light and dark backgrounds.
 */
function emailShell({
    heading,
    body,
    primaryCtaLabel,
    primaryCtaUrl,
    secondaryCtaLabel,
    secondaryCtaUrl,
    footer,
}: EmailShellParams): string {
    const secondary =
        secondaryCtaLabel && secondaryCtaUrl
            ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(secondaryCtaUrl)}" style="color:#4f46e5;text-decoration:underline;font-size:14px;">${escapeHtml(secondaryCtaLabel)}</a></p>`
            : '';
    return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111827;">Fewya</p>
        </td></tr>
        <tr><td style="padding:8px 32px 4px;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#111827;font-weight:700;">${escapeHtml(heading)}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 0;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(body)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 28px;">
          <a href="${escapeHtml(primaryCtaUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">${escapeHtml(primaryCtaLabel)}</a>
          ${secondary}
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(footer)}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Builds the email + push content for a notification type. Pure function (no I/O)
 * so it is unit-testable. Email/push localisation is intentionally deferred —
 * every caller passes the Spanish strings object for now. When user-locale-aware
 * notifications are needed, plumb the recipient's preferred locale in here.
 */
export function buildNotification(type: NotificationType, data: NotificationData, t: Strings = fallbackEs): BuiltNotification {
    const order = data.orderPublicId;
    const shop = data.shopName ?? (t === fallbackEs ? 'la tienda' : 'the shop');
    const point = data.pickupPointName ?? (t === fallbackEs ? 'el punto de recogida' : 'the pickup point');
    const vars = { order, shop, point };

    switch (type) {
        case NOTIFICATION_TYPE.BUYER_READY_TO_SEND: {
            const url = data.trackingUrl || buyerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifBuyerReadyToSendSubject, vars),
                emailHtml: emailShell({
                    heading: t.notifBuyerReadyToSendHeading,
                    body: interpolate(t.notifBuyerReadyToSendText, vars),
                    primaryCtaLabel: data.trackingUrl ? t.notifTrackCta : t.emailViewOrderCta,
                    primaryCtaUrl: url,
                    secondaryCtaLabel: data.trackingUrl ? t.emailViewOrderCta : undefined,
                    secondaryCtaUrl: data.trackingUrl ? buyerOrderUrl(order) : undefined,
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifBuyerReadyToSendPushTitle,
                pushBody: interpolate(t.notifBuyerReadyToSendPushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.BUYER_PICKUP_READY: {
            const url = data.trackingUrl || buyerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifBuyerPickupReadySubject, vars),
                emailHtml: emailShell({
                    heading: t.notifBuyerPickupReadyHeading,
                    body: interpolate(t.notifBuyerPickupReadyText, vars),
                    primaryCtaLabel: t.emailViewOrderCta,
                    primaryCtaUrl: buyerOrderUrl(order),
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifBuyerPickupReadyPushTitle,
                pushBody: interpolate(t.notifBuyerPickupReadyPushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER: {
            const url = data.trackingUrl || buyerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifBuyerPickupReminderSubject, vars),
                emailHtml: emailShell({
                    heading: t.notifBuyerPickupReminderHeading,
                    body: interpolate(t.notifBuyerPickupReminderText, vars),
                    primaryCtaLabel: t.emailViewOrderCta,
                    primaryCtaUrl: buyerOrderUrl(order),
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifBuyerPickupReminderPushTitle,
                pushBody: interpolate(t.notifBuyerPickupReminderPushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY: {
            const url = data.trackingUrl || buyerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifBuyerOutForDeliverySubject, vars),
                emailHtml: emailShell({
                    heading: t.notifBuyerOutForDeliveryHeading,
                    body: interpolate(t.notifBuyerOutForDeliveryText, vars),
                    primaryCtaLabel: data.trackingUrl ? t.notifTrackCta : t.emailViewOrderCta,
                    primaryCtaUrl: url,
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifBuyerOutForDeliveryPushTitle,
                pushBody: interpolate(t.notifBuyerOutForDeliveryPushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.SELLER_NEW_SALE: {
            const url = sellerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifSellerNewSaleSubject, vars),
                emailHtml: emailShell({
                    heading: t.notifSellerNewSaleHeading,
                    body: interpolate(t.notifSellerNewSaleText, vars),
                    primaryCtaLabel: t.notifManageOrderCta,
                    primaryCtaUrl: url,
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifSellerNewSalePushTitle,
                pushBody: interpolate(t.notifSellerNewSalePushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.SELLER_LABEL_REMINDER: {
            const url = sellerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifSellerLabelReminderSubject, vars),
                emailHtml: emailShell({
                    heading: t.notifSellerLabelReminderHeading,
                    body: interpolate(t.notifSellerLabelReminderText, vars),
                    primaryCtaLabel: t.notifManageOrderCta,
                    primaryCtaUrl: url,
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifSellerLabelReminderPushTitle,
                pushBody: interpolate(t.notifSellerLabelReminderPushBody, vars),
                url,
            };
        }
        case NOTIFICATION_TYPE.SELLER_SHIP_REMINDER: {
            const url = sellerOrderUrl(order);
            return {
                emailSubject: interpolate(t.notifSellerShipReminderSubject, vars),
                emailHtml: emailShell({
                    heading: t.notifSellerShipReminderHeading,
                    body: interpolate(t.notifSellerShipReminderText, vars),
                    primaryCtaLabel: t.notifManageOrderCta,
                    primaryCtaUrl: url,
                    footer: t.emailFooter,
                }),
                pushTitle: t.notifSellerShipReminderPushTitle,
                pushBody: interpolate(t.notifSellerShipReminderPushBody, vars),
                url,
            };
        }
    }
}
