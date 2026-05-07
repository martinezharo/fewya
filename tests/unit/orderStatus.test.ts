import { describe, it, expect } from 'vitest';
import { ORDER_STATUSES, orderStatusLabels } from '../../src/lib/orders/orderStatus';

describe('ORDER_STATUSES', () => {
    it('contiene todos los estados esperados', () => {
        const expected = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'cancelled'];
        expect(ORDER_STATUSES).toEqual(expected);
    });

    it('tiene exactamente 8 estados', () => {
        expect(ORDER_STATUSES).toHaveLength(8);
    });
});

describe('orderStatusLabels', () => {
    it('tiene una etiqueta para cada estado', () => {
        for (const status of ORDER_STATUSES) {
            expect(orderStatusLabels[status]).toBeDefined();
            expect(typeof orderStatusLabels[status]).toBe('string');
            expect(orderStatusLabels[status].length).toBeGreaterThan(0);
        }
    });

    it('las etiquetas no están vacías', () => {
        for (const status of ORDER_STATUSES) {
            expect(orderStatusLabels[status]).not.toBe('');
        }
    });
});
