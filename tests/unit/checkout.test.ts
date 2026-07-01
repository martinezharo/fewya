import { describe, it, expect } from 'vitest';
import {
    toMinorUnits,
    fromMinorUnits,
    buildShopPayouts,
    calculateOrderTotal,
    normalizeCheckoutItems,
    buildStripeLineItems,
    type CheckoutPricedItem,
    type CheckoutResolvedItem,
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

function createResolvedItem(overrides: Partial<CheckoutResolvedItem> = {}): CheckoutResolvedItem {
    return {
        ...createItem(),
        productId: 'prod-1',
        productTitle: 'Producto A',
        productSlug: 'producto-a',
        variantId: 'var-1',
        variantName: 'Talla M',
        image: null,
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

describe('normalizeCheckoutItems', () => {
    it('deja pasar items válidos sin cambios', () => {
        const result = normalizeCheckoutItems([
            { variantId: 'var-1', quantity: 2 },
            { variantId: 'var-2', quantity: 1 },
        ]);
        expect(result).toEqual([
            { variantId: 'var-1', quantity: 2 },
            { variantId: 'var-2', quantity: 1 },
        ]);
    });

    it('fusiona variantes duplicadas sumando cantidades', () => {
        const result = normalizeCheckoutItems([
            { variantId: 'var-1', quantity: 2 },
            { variantId: 'var-1', quantity: 3 },
        ]);
        expect(result).toEqual([{ variantId: 'var-1', quantity: 5 }]);
    });

    it('rechaza cantidades no enteras', () => {
        expect(normalizeCheckoutItems([{ variantId: 'var-1', quantity: 1.5 }])).toBeNull();
    });

    it('rechaza cantidades menores a 1', () => {
        expect(normalizeCheckoutItems([{ variantId: 'var-1', quantity: 0 }])).toBeNull();
        expect(normalizeCheckoutItems([{ variantId: 'var-1', quantity: -1 }])).toBeNull();
    });

    it('rechaza cantidades mayores a 99', () => {
        expect(normalizeCheckoutItems([{ variantId: 'var-1', quantity: 100 }])).toBeNull();
    });

    it('acepta el límite exacto de 99', () => {
        expect(normalizeCheckoutItems([{ variantId: 'var-1', quantity: 99 }])).toEqual([
            { variantId: 'var-1', quantity: 99 },
        ]);
    });

    it('rechaza variantId vacío', () => {
        expect(normalizeCheckoutItems([{ variantId: '', quantity: 1 }])).toBeNull();
    });

    it('devuelve array vacío para entrada vacía', () => {
        expect(normalizeCheckoutItems([])).toEqual([]);
    });

    it('reaplica el tope de 99 tras fusionar duplicados', () => {
        expect(normalizeCheckoutItems([
            { variantId: 'var-1', quantity: 60 },
            { variantId: 'var-1', quantity: 60 },
        ])).toBeNull();
    });

    it('acepta duplicados que al fusionarse siguen dentro del tope', () => {
        expect(normalizeCheckoutItems([
            { variantId: 'var-1', quantity: 40 },
            { variantId: 'var-1', quantity: 59 },
        ])).toEqual([{ variantId: 'var-1', quantity: 99 }]);
    });
});

describe('buildStripeLineItems', () => {
    const t = { cartShipping: 'Envío' };

    it('genera una línea de producto y una de envío por tienda', () => {
        const lineItems = buildStripeLineItems(t, [createResolvedItem()]);
        expect(lineItems).toHaveLength(2);

        const [product, shipping] = lineItems;
        expect(product.price_data.product_data.metadata.type).toBe('product');
        expect(shipping.price_data.product_data.metadata.type).toBe('shipping');
    });

    it('convierte precios a céntimos y usa EUR', () => {
        const [product] = buildStripeLineItems(t, [
            createResolvedItem({ unitPrice: 9.99, shippingCost: 3.5 }),
        ]);
        expect(product.price_data.unit_amount).toBe(999);
        expect(product.price_data.currency).toBe('eur');
    });

    it('usa el envío máximo por tienda y lo etiqueta con el nombre de la tienda', () => {
        const lineItems = buildStripeLineItems(t, [
            createResolvedItem({ shopId: 'shop-a', shopName: 'Tienda A', variantId: 'v1', shippingCost: 2 }),
            createResolvedItem({ shopId: 'shop-a', shopName: 'Tienda A', variantId: 'v2', shippingCost: 5 }),
        ]);

        const shipping = lineItems.filter((li) => li.price_data.product_data.metadata.type === 'shipping');
        expect(shipping).toHaveLength(1);
        expect(shipping[0].price_data.unit_amount).toBe(500); // max(2, 5) → céntimos
        expect(shipping[0].price_data.product_data.name).toBe('Envío · Tienda A');
    });

    it('genera una línea de envío por cada tienda distinta', () => {
        const lineItems = buildStripeLineItems(t, [
            createResolvedItem({ shopId: 'shop-a', variantId: 'v1' }),
            createResolvedItem({ shopId: 'shop-b', variantId: 'v2' }),
        ]);
        const shipping = lineItems.filter((li) => li.price_data.product_data.metadata.type === 'shipping');
        expect(shipping).toHaveLength(2);
    });

    it('usa variantName como descripción del producto', () => {
        const [product] = buildStripeLineItems(t, [
            createResolvedItem({ variantName: 'Talla L' }),
        ]);
        expect(product.price_data.product_data.description).toBe('Talla L');
    });

    it('deja la descripción undefined cuando no hay variantName', () => {
        const [product] = buildStripeLineItems(t, [
            createResolvedItem({ variantName: null }),
        ]);
        expect(product.price_data.product_data.description).toBeUndefined();
    });
});
