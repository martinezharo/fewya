import { describe, it, expect } from 'vitest';
import { SHIPMENT_STATUS, SHIPMENT_STATUSES, type ShipmentStatus } from '../../src/lib/shipping/shipmentStatus';

describe('SHIPMENT_STATUS', () => {
    it('exposes the expected status keys and values', () => {
        expect(SHIPMENT_STATUS).toEqual({
            PENDING: 'pending',
            LABEL_READY: 'label_ready',
            SHIPPED: 'shipped',
            DELIVERED: 'delivered',
            FAILED: 'failed',
            CANCELLED: 'cancelled',
        });
    });

    it('is usable as a discriminant type for ShipmentStatus', () => {
        const status: ShipmentStatus = SHIPMENT_STATUS.SHIPPED;
        expect(status).toBe('shipped');
    });
});

describe('SHIPMENT_STATUSES', () => {
    it('lists every status value exactly once, in declaration order', () => {
        expect(SHIPMENT_STATUSES).toEqual([
            'pending',
            'label_ready',
            'shipped',
            'delivered',
            'failed',
            'cancelled',
        ]);
    });

    it('has no duplicate entries', () => {
        expect(new Set(SHIPMENT_STATUSES).size).toBe(SHIPMENT_STATUSES.length);
    });

    it('every SHIPMENT_STATUS value appears in SHIPMENT_STATUSES', () => {
        for (const value of Object.values(SHIPMENT_STATUS)) {
            expect(SHIPMENT_STATUSES).toContain(value);
        }
    });
});
