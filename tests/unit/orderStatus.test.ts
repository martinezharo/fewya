import { describe, it, expect } from 'vitest';
import { ORDER_STATUSES, getOrderStatusLabels } from '../../src/lib/orders/orderStatus';
import { es } from '../../src/lib/core/i18n/strings.es';
import { en } from '../../src/lib/core/i18n/strings.en';

describe('ORDER_STATUSES', () => {
    it('contiene todos los estados esperados', () => {
        const expected = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'delivery_failed', 'cancelled', 'refunded'];
        expect(ORDER_STATUSES).toEqual(expected);
    });

    it('tiene exactamente 10 estados', () => {
        expect(ORDER_STATUSES).toHaveLength(10);
    });
});

describe('orderStatusLabels', () => {
    it('tiene una etiqueta para cada estado (es + en)', () => {
        for (const strings of [es, en]) {
            const labels = getOrderStatusLabels(strings);
            for (const status of ORDER_STATUSES) {
                expect(labels[status]).toBeDefined();
                expect(typeof labels[status]).toBe('string');
                expect(labels[status].length).toBeGreaterThan(0);
            }
        }
    });

    it('las etiquetas no están vacías (es + en)', () => {
        for (const strings of [es, en]) {
            const labels = getOrderStatusLabels(strings);
            for (const status of ORDER_STATUSES) {
                expect(labels[status]).not.toBe('');
            }
        }
    });
});
