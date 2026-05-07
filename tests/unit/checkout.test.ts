import { describe, it, expect } from 'vitest';
import {
    toMinorUnits,
    fromMinorUnits,
    buildShopPayouts,
    calculateOrderTotal,
    type CheckoutPricedItem,
} from '../../src/lib/cart/checkout';

function createItem(overrides: Partial<CheckoutPricedItem> = {}): CheckoutPricedItem {
    return {
        shopId: 'shop-1',
        shopName: 'Tienda A',
        shopSlug: 'tienda-a',
        stripeAccountId: 'acct_123',
        quantity: 1,
        unitPrice: 10,
        shippingCost: 2.5,
        ...overrides,
    };
}

describe('toMinorUnits', () => {
    it('convierte euros a céntimos correctamente', () => {
        expect(toMinorUnits(10.99)).toBe(1099);
        expect(toMinorUnits(0.01)).toBe(1);
        expect(toMinorUnits(100)).toBe(10000);
    });

    it('redondea correctamente evitando errores de punto flotante', () => {
        expect(toMinorUnits(10.005)).toBe(1001);
        expect(toMinorUnits(10.004)).toBe(1000);
    });
});

describe('fromMinorUnits', () => {
    it('convierte céntimos a euros correctamente', () => {
        expect(fromMinorUnits(1099)).toBe(10.99);
        expect(fromMinorUnits(1)).toBe(0.01);
        expect(fromMinorUnits(10000)).toBe(100);
    });
});

describe('buildShopPayouts', () => {
    it('agrupa items por tienda y suma subtotales', () => {
        const items: CheckoutPricedItem[] = [
            createItem({ shopId: 'shop-a', unitPrice: 10, quantity: 2, shippingCost: 3 }),
            createItem({ shopId: 'shop-a', unitPrice: 5, quantity: 1, shippingCost: 2 }),
        ];

        const payouts = buildShopPayouts(items);
        expect(payouts).toHaveLength(1);
        expect(payouts[0].subtotal).toBe(25); // 10*2 + 5*1
        expect(payouts[0].shipping).toBe(3); // max(3, 2)
        expect(payouts[0].total).toBe(28);
    });

    it('mantiene envío más caro cuando hay múltiples items de la misma tienda', () => {
        const items: CheckoutPricedItem[] = [
            createItem({ shopId: 'shop-a', unitPrice: 10, quantity: 1, shippingCost: 5 }),
            createItem({ shopId: 'shop-a', unitPrice: 5, quantity: 1, shippingCost: 2 }),
        ];

        const payouts = buildShopPayouts(items);
        expect(payouts[0].shipping).toBe(5);
    });

    it('genera un payout por cada tienda distinta', () => {
        const items: CheckoutPricedItem[] = [
            createItem({ shopId: 'shop-a', unitPrice: 10, quantity: 1, shippingCost: 3 }),
            createItem({ shopId: 'shop-b', unitPrice: 20, quantity: 1, shippingCost: 4 }),
        ];

        const payouts = buildShopPayouts(items);
        expect(payouts).toHaveLength(2);
    });

    it('devuelve array vacío para array vacío', () => {
        expect(buildShopPayouts([])).toEqual([]);
    });

    it('calcula correctamente con cantidades mayores a 1', () => {
        const items: CheckoutPricedItem[] = [
            createItem({ shopId: 'shop-a', unitPrice: 9.99, quantity: 3, shippingCost: 3.5 }),
        ];

        const payouts = buildShopPayouts(items);
        expect(payouts[0].subtotal).toBeCloseTo(29.97, 2);
        expect(payouts[0].total).toBeCloseTo(33.47, 2);
    });
});

describe('calculateOrderTotal', () => {
    it('suma totales de todas las tiendas', () => {
        const items: CheckoutPricedItem[] = [
            createItem({ shopId: 'shop-a', unitPrice: 10, quantity: 1, shippingCost: 3 }),
            createItem({ shopId: 'shop-b', unitPrice: 20, quantity: 1, shippingCost: 4 }),
        ];

        expect(calculateOrderTotal(items)).toBe(37); // (10+3) + (20+4)
    });

    it('devuelve 0 para carrito vacío', () => {
        expect(calculateOrderTotal([])).toBe(0);
    });
});
