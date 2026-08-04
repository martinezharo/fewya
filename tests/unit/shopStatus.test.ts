import { describe, expect, it } from 'vitest';
import { SHOP_STATUS, SHOP_STATUSES } from '../../src/lib/core/shopStatus';

describe('shop status', () => {
    it('keeps the database values in one stable, exhaustive list', () => {
        expect(SHOP_STATUS).toEqual({ ACTIVE: 'active', INACTIVE: 'inactive' });
        expect(SHOP_STATUSES).toEqual(['active', 'inactive']);
        expect(new Set(SHOP_STATUSES).size).toBe(SHOP_STATUSES.length);
    });
});
