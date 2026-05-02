import { strings } from './i18n';

export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const orderStatusLabels: Record<OrderStatus, string> = {
    pending: strings.orderStatusPending,
    paid: strings.orderStatusPaid,
    processing: strings.orderStatusProcessing,
    shipped: strings.orderStatusShipped,
    delivered: strings.orderStatusDelivered,
    confirmed: strings.orderStatusConfirmed,
    incident: strings.orderStatusIncident,
    cancelled: strings.orderStatusCancelled,
};
