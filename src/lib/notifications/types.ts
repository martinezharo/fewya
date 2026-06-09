/**
 * Notification types. Each value is the dedupe key stored in
 * notification_log.type together with the order id (UNIQUE(order_id, type)).
 */
export const NOTIFICATION_TYPE = {
    // Buyer
    BUYER_READY_TO_SEND: 'buyer_ready_to_send',
    BUYER_PICKUP_READY: 'buyer_pickup_ready',
    BUYER_PICKUP_REMINDER: 'buyer_pickup_reminder',
    BUYER_OUT_FOR_DELIVERY: 'buyer_out_for_delivery',
    // Seller
    SELLER_NEW_SALE: 'seller_new_sale',
    SELLER_LABEL_REMINDER: 'seller_label_reminder',
    SELLER_SHIP_REMINDER: 'seller_ship_reminder',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

/** Which party receives a given notification. */
export type NotificationRecipient = 'buyer' | 'seller';

/** Data interpolated into email/push templates. All optional except orderPublicId. */
export interface NotificationData {
    orderPublicId: string;
    shopName?: string;
    trackingUrl?: string | null;
    pickupPointName?: string | null;
}

/** A subscription row as stored in push_subscriptions. */
export interface StoredPushSubscription {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
}
