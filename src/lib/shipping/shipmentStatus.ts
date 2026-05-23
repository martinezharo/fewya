export const SHIPMENT_STATUS = {
    PENDING: 'pending',
    LABEL_READY: 'label_ready',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
} as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS)[keyof typeof SHIPMENT_STATUS];
export const SHIPMENT_STATUSES = Object.values(SHIPMENT_STATUS) as ShipmentStatus[];
