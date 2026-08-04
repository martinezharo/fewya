import { beforeEach, describe, expect, it, vi } from 'vitest';

const responses = vi.hoisted(() => new Map<string, { data: unknown; error?: { message: string } | null }>());

function query(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(responses.get(table) ?? { data: null, error: null }));
    chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(responses.get(table) ?? { data: null, error: null }).then(resolve);
    return chain;
}

vi.mock('../../src/lib/core/supabase', () => ({
    supabase: { from: (table: string) => query(table) },
}));

const { GET, OPTIONS } = await import('../../src/pages/api/public/shops/[shopSlug]/catalog.json');

const shop = {
    id: 'shop-1', slug: 'octopus-control', name: 'Octopus Control', is_active: true,
    status: 'active', payments_active: true, seller_details_complete: true,
};
const product = {
    id: 'product-1', shop_id: 'shop-1', slug: 'mando-lg', title: 'Mando LG', description: 'Mando compatible LG',
    category: 'tecnologia', brand: 'LG', gallery_images: ['https://cdn.test/lg.webp'],
    specifications: { compatible: 'LG' }, is_active: true, created_at: '2026-08-01T00:00:00Z',
    variants: [{ price: 12.5, stock: 2, is_default: true, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }],
};

function context(slug = 'octopus-control') {
    return { params: { shopSlug: slug }, url: new URL(`https://preview.test/api/public/shops/${slug}/catalog.json`) } as never;
}

beforeEach(() => {
    responses.clear();
    responses.set('shops', { data: shop });
    responses.set('products', { data: [product], error: null });
});

describe('public catalog feed contract', () => {
    it('returns the versioned Octopus Control boundary without private inventory fields', async () => {
        const response = await GET(context());
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toContain('public');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

        const body = await response.json();
        expect(body).toEqual({
            version: 1,
            generated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            shop: { slug: 'octopus-control', name: 'Octopus Control', url: 'https://fewya.com/octopus-control' },
            products: [{
                id: 'product-1', slug: 'mando-lg', title: 'Mando LG', description: 'Mando compatible LG',
                brand: 'LG', category: 'tecnologia', images: ['https://cdn.test/lg.webp'],
                specifications: { compatible: 'LG' }, price: 12.5, currency: 'EUR', in_stock: true,
                url: 'https://fewya.com/octopus-control/mando-lg', created_at: '2026-08-01T00:00:00Z',
            }],
        });
        expect(body.products[0]).not.toHaveProperty('stock');
        expect(Object.keys(body.products[0]).sort()).toEqual([
            'brand', 'category', 'created_at', 'currency', 'description', 'id', 'images', 'in_stock',
            'price', 'slug', 'specifications', 'title', 'url',
        ]);
    });

    it('fails closed and disables caching for hidden shops or database errors', async () => {
        responses.set('shops', { data: { ...shop, payments_active: false } });
        const hidden = await GET(context());
        expect(hidden.status).toBe(404);
        expect(hidden.headers.get('Cache-Control')).toBe('no-store');

        responses.set('shops', { data: shop });
        responses.set('products', { data: null, error: { message: 'down' } });
        const unavailable = await GET(context());
        expect(unavailable.status).toBe(502);
        expect(unavailable.headers.get('Cache-Control')).toBe('no-store');
    });

    it('advertises read-only cross-origin access', async () => {
        const response = await OPTIONS({} as never);
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    });
});
