import { describe, it, expect } from 'vitest';
import { buildPublicCatalog, isShopPubliclyVisible, PUBLIC_CATALOG_VERSION } from '../../src/lib/products/publicCatalog';
import { getDefaultVariant, getTotalStock, isInStock, sortVariants } from '../../src/lib/products/variants';
import type { Product, Shop } from '../../src/lib/core/types';

const ORIGIN = 'https://fewya.com';

function makeShop(overrides: Partial<Shop> = {}): Shop {
    return {
        id: 'shop-1',
        slug: 'octopus-control',
        name: 'Octopus Control',
        is_active: true,
        status: 'active',
        payments_active: true,
        seller_details_complete: true,
    } as Shop;
}

function makeVariant(overrides: Record<string, unknown> = {}) {
    return {
        id: 'v1',
        price: 5.5,
        stock: 3,
        is_default: true,
        weight_kg: 0.1,
        length_cm: 10,
        width_cm: 5,
        height_cm: 2,
        shipping_cost: 0,
        ...overrides,
    };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
    return {
        id: 'p1',
        shop_id: 'shop-1',
        slug: 'mando-lg-akb75675304',
        title: 'Mando LG AKB75675304',
        description: 'Mando compatible LG',
        category: 'tecnologia',
        brand: 'LG',
        gallery_images: ['https://cdn/img-1.webp'],
        specifications: {},
        is_active: true,
        created_at: '2026-02-07T10:56:51.541706+00:00',
        variants: [makeVariant()],
        ...overrides,
    } as Product;
}

describe('variant helpers', () => {
    it('prefers the default variant and falls back to the first one', () => {
        const a = makeVariant({ id: 'a', is_default: false, price: 1 });
        const b = makeVariant({ id: 'b', is_default: true, price: 2 });
        expect(getDefaultVariant([a, b])?.id).toBe('b');
        expect(getDefaultVariant([a])?.id).toBe('a');
        expect(getDefaultVariant([])).toBeUndefined();
        expect(getDefaultVariant(null)).toBeUndefined();
    });

    it('sorts the default variant first without mutating the input', () => {
        const input = [makeVariant({ id: 'a', is_default: false }), makeVariant({ id: 'b', is_default: true })];
        const sorted = sortVariants(input);
        expect(sorted.map(v => v.id)).toEqual(['b', 'a']);
        expect(input.map(v => v.id)).toEqual(['a', 'b']);
    });

    it('totals stock and reports availability', () => {
        const variants = [makeVariant({ stock: 2 }), makeVariant({ stock: 0 })];
        expect(getTotalStock(variants)).toBe(2);
        expect(isInStock(variants)).toBe(true);
        expect(isInStock([makeVariant({ stock: 0 })])).toBe(false);
        expect(isInStock([])).toBe(false);
        expect(isInStock(undefined)).toBe(false);
    });
});

describe('isShopPubliclyVisible', () => {
    it('accepts a fully onboarded active shop', () => {
        expect(isShopPubliclyVisible(makeShop())).toBe(true);
    });

    it.each([
        ['inactive', { is_active: false }],
        ['suspended status', { status: 'inactive' as const }],
        ['payments off', { payments_active: false }],
        ['incomplete seller details', { seller_details_complete: false }],
    ])('rejects a shop with %s', (_label, patch) => {
        expect(isShopPubliclyVisible({ ...makeShop(), ...patch } as Shop)).toBe(false);
    });

    it('rejects a missing shop', () => {
        expect(isShopPubliclyVisible(null)).toBe(false);
        expect(isShopPubliclyVisible(undefined)).toBe(false);
    });
});

describe('buildPublicCatalog', () => {
    it('serializes a product with its canonical URL and default price', () => {
        const catalog = buildPublicCatalog(makeShop(), [makeProduct()], ORIGIN);

        expect(catalog.version).toBe(PUBLIC_CATALOG_VERSION);
        expect(catalog.shop).toEqual({
            slug: 'octopus-control',
            name: 'Octopus Control',
            url: 'https://fewya.com/octopus-control',
        });
        expect(catalog.products).toHaveLength(1);
        expect(catalog.products[0]).toMatchObject({
            id: 'p1',
            slug: 'mando-lg-akb75675304',
            title: 'Mando LG AKB75675304',
            brand: 'LG',
            price: 5.5,
            currency: 'EUR',
            in_stock: true,
            url: 'https://fewya.com/octopus-control/mando-lg-akb75675304',
        });
    });

    it('keeps out-of-stock products so mirrors can keep the URL alive', () => {
        const oos = makeProduct({ variants: [makeVariant({ stock: 0 })] as Product['variants'] });
        const catalog = buildPublicCatalog(makeShop(), [oos], ORIGIN);

        expect(catalog.products).toHaveLength(1);
        expect(catalog.products[0].in_stock).toBe(false);
        expect(catalog.products[0].price).toBe(5.5);
    });

    it('never exposes exact inventory levels', () => {
        const catalog = buildPublicCatalog(makeShop(), [makeProduct()], ORIGIN);
        expect(JSON.stringify(catalog)).not.toContain('"stock"');
        expect(catalog.products[0]).not.toHaveProperty('stock');
    });

    it('drops deactivated products', () => {
        const catalog = buildPublicCatalog(makeShop(), [makeProduct({ is_active: false })], ORIGIN);
        expect(catalog.products).toHaveLength(0);
    });

    it('drops incomplete products that the storefront would not render', () => {
        const noImages = makeProduct({ id: 'p2', slug: 'no-images', gallery_images: [] });
        const noVariants = makeProduct({ id: 'p3', slug: 'no-variants', variants: [] });
        const catalog = buildPublicCatalog(makeShop(), [makeProduct(), noImages, noVariants], ORIGIN);

        expect(catalog.products.map(p => p.slug)).toEqual(['mando-lg-akb75675304']);
    });

    it('returns products in a stable slug order', () => {
        const catalog = buildPublicCatalog(
            makeShop(),
            [
                makeProduct({ id: 'b', slug: 'zeta' }),
                makeProduct({ id: 'a', slug: 'alfa' }),
            ],
            ORIGIN
        );
        expect(catalog.products.map(p => p.slug)).toEqual(['alfa', 'zeta']);
    });
});
