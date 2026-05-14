import { describe, it, expect } from 'vitest';
import {
    pickOne,
    extractPayoutContext,
    buildPayoutItemsFromJoins,
    type JoinedOrderItem,
} from '../../src/lib/orders/orderJoins';

describe('pickOne', () => {
    it('devuelve el primer elemento de un array', () => {
        expect(pickOne([1, 2, 3])).toBe(1);
    });

    it('devuelve null para array vacío', () => {
        expect(pickOne([])).toBeNull();
    });

    it('devuelve null/undefined como null', () => {
        expect(pickOne(null)).toBeNull();
        expect(pickOne(undefined)).toBeNull();
    });

    it('devuelve el valor escalar sin tocar', () => {
        const obj = { id: 'x' };
        expect(pickOne(obj)).toBe(obj);
    });
});

function buildItem(opts: {
    qty?: number;
    price?: number;
    shipping?: number;
    stripeAccountId?: string | null;
    shop?: { id?: string; name?: string; slug?: string } | null;
} = {}): JoinedOrderItem {
    const shop = opts.shop === null ? null : {
        id: opts.shop?.id ?? 'shop-1',
        name: opts.shop?.name ?? 'Tienda',
        slug: opts.shop?.slug ?? 'tienda',
        shop_payment_accounts: opts.stripeAccountId === null ? null : {
            stripe_account_id: opts.stripeAccountId ?? 'acct_1',
        },
    };
    return {
        quantity: opts.qty ?? 1,
        price_at_purchase: opts.price ?? 10,
        product_variants: {
            shipping_cost: opts.shipping ?? 2.5,
            products: {
                id: 'p1',
                title: 'Producto',
                slug: 'producto',
                shops: shop,
            },
        },
    };
}

describe('extractPayoutContext', () => {
    it('extrae shop, paymentAccount, quantity, unitPrice y shippingCost', () => {
        const ctx = extractPayoutContext(buildItem({ qty: 3, price: 12, shipping: 4 }));
        expect(ctx.shop?.id).toBe('shop-1');
        expect(ctx.paymentAccount?.stripe_account_id).toBe('acct_1');
        expect(ctx.quantity).toBe(3);
        expect(ctx.unitPrice).toBe(12);
        expect(ctx.shippingCost).toBe(4);
    });

    it('soporta arrays anidados (Supabase a veces devuelve listas)', () => {
        const item: JoinedOrderItem = {
            quantity: 1,
            price_at_purchase: 5,
            product_variants: [{
                shipping_cost: 2,
                products: [{
                    id: 'p',
                    title: 't',
                    slug: 's',
                    shops: [{
                        id: 'shop-x',
                        name: 'X',
                        slug: 'x',
                        shop_payment_accounts: [{ stripe_account_id: 'acct_x' }],
                    }],
                }],
            }],
        };
        const ctx = extractPayoutContext(item);
        expect(ctx.shop?.id).toBe('shop-x');
        expect(ctx.paymentAccount?.stripe_account_id).toBe('acct_x');
    });

    it('cuando falta shop devuelve nulls sin lanzar', () => {
        const ctx = extractPayoutContext({ quantity: 1, price_at_purchase: 1 });
        expect(ctx.shop).toBeNull();
        expect(ctx.paymentAccount).toBeNull();
    });
});

describe('buildPayoutItemsFromJoins', () => {
    it('omite items sin shop o sin stripe_account_id', () => {
        const items = [
            buildItem({ qty: 1, price: 10, shipping: 2 }),
            buildItem({ stripeAccountId: null }),
            buildItem({ shop: null }),
        ];
        const out = buildPayoutItemsFromJoins(items);
        expect(out).toHaveLength(1);
        expect(out[0].shopId).toBe('shop-1');
        expect(out[0].quantity).toBe(1);
        expect(out[0].unitPrice).toBe(10);
        expect(out[0].shippingCost).toBe(2);
    });

    it('mapea los campos esperados por releaseOrderFunds', () => {
        const out = buildPayoutItemsFromJoins([buildItem({ qty: 2, price: 9.99, shipping: 1 })]);
        expect(out[0]).toMatchObject({
            shopId: 'shop-1',
            shopName: 'Tienda',
            shopSlug: 'tienda',
            stripeAccountId: 'acct_1',
            quantity: 2,
            unitPrice: 9.99,
            shippingCost: 1,
        });
    });
});
