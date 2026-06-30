import type { Strings } from '../core/i18n';

export const ORDER_STATUS = {
    PENDING: 'pending',
    PAID: 'paid',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CONFIRMED: 'confirmed',
    INCIDENT: 'incident',
    DELIVERY_FAILED: 'delivery_failed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export const ORDER_STATUSES = Object.values(ORDER_STATUS) as OrderStatus[];

export const PAYMENT_STATUS = {
    PENDING: 'pending',
    PAID: 'paid',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const FUNDS_RELEASE_STATUS = {
    PENDING: 'pending',
    RELEASED: 'released',
    FAILED: 'failed',
} as const;
export type FundsReleaseStatus = (typeof FUNDS_RELEASE_STATUS)[keyof typeof FUNDS_RELEASE_STATUS];

export const DELIVERY_TYPE = {
    HOME: 'home',
    PICKUP_POINT: 'pickup_point',
} as const;
export type DeliveryType = (typeof DELIVERY_TYPE)[keyof typeof DELIVERY_TYPE];

export function getOrderStatusLabels(t: Strings): Record<OrderStatus, string> {
    return {
        pending: t.orderStatusPending,
        paid: t.orderStatusPaid,
        processing: t.orderStatusProcessing,
        shipped: t.orderStatusShipped,
        delivered: t.orderStatusDelivered,
        confirmed: t.orderStatusConfirmed,
        incident: t.orderStatusIncident,
        delivery_failed: t.orderStatusDeliveryFailed,
        cancelled: t.orderStatusCancelled,
        refunded: t.orderStatusRefunded,
    };
}
