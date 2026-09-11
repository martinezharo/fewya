import { describe, expect, it } from 'vitest';
import { isSellerOrderVisible } from '../../src/lib/orders/sellerOrdersFilter';

describe('seller orders filter', () => {
    it('hides pending orders by default', () => {
        expect(isSellerOrderVisible('pending', 'all', false)).toBe(false);
        expect(isSellerOrderVisible('paid', 'all', false)).toBe(true);
    });

    it('shows pending orders when explicitly enabled', () => {
        expect(isSellerOrderVisible('pending', 'all', true)).toBe(true);
    });

    it('keeps pending orders hidden when the pending status is selected', () => {
        expect(isSellerOrderVisible('pending', 'pending', false)).toBe(false);
    });

    it('combines a selected status with pending visibility', () => {
        expect(isSellerOrderVisible('pending', 'pending', true)).toBe(true);
        expect(isSellerOrderVisible('paid', 'pending', true)).toBe(false);
        expect(isSellerOrderVisible('processing', 'paid', false)).toBe(false);
        expect(isSellerOrderVisible('paid', 'paid', false)).toBe(true);
    });
});
