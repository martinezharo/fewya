import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());

// The loss-protection rule needs a live Sendcloud quote; it has its own suite.
const enforceVariantPricing = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/products/pricingEnforcement', () => ({ enforceVariantPricing }));

const { POST, PATCH } = await import('../../src/pages/api/sell/catalog/product');

const completeVariant = {
    variant_name: 'Single',
    price: 4.99,
    stock: 9,
    is_default: true,
    weight_kg: 0.4,
    length_cm: 25,
    width_cm: 20,
    height_cm: 10,
    shipping_cost: 4.49,
};

const completeProduct = {
    title: 'Mando',
    slug: 'mando',
    description: 'A controller',
    category: 'gaming',
    gallery_images: ['https://cdn.fewya.com/mando.webp'],
    is_active: true,
    variants: [completeVariant],
};

function patch(body: unknown, { rawBody, id = 'convex:product:1' }: { rawBody?: string; id?: string } = {}) {
    const url = new URL(`https://fewya.com/api/sell/catalog/product?id=${id}`);
    const request = new Request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return PATCH({ locals: { t: en, locale: 'en' }, request, url } as any);
}

function post(body: unknown) {
    const request = new Request('https://fewya.com/api/sell/catalog/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

function variantsSentToConvex() {
    return convex.mutation.mock.calls[0][1].variants;
}

describe('seller product route', () => {
    beforeEach(() => {
        convex.reset();
        enforceVariantPricing.mockReset();
        enforceVariantPricing.mockResolvedValue({ ok: true, errors: [] });
        convex.query.mockResolvedValue({ allowLoss: false, isActive: true, variants: [] });
        convex.mutation.mockResolvedValue({ product: { id: 'convex:product:1' } });
    });

    it('refuses an anonymous caller', async () => {
        convex.reset(null);
        expect((await patch(completeProduct)).status).toBe(401);
        expect((await post(completeProduct)).status).toBe(401);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    // Regression: the form posts `null` for every optional text field the
    // seller left blank, and the route used to call `.trim()` on it, so saving
    // a product without a brand answered an opaque 500.
    it('saves a product whose optional text fields were left blank', async () => {
        const res = await patch({ ...completeProduct, brand: null, description: null });
        expect(res.status).toBe(200);
        expect(convex.mutation.mock.calls[0][1]).toMatchObject({ brand: null, description: null });
    });

    it('creates a product whose optional text fields were left blank', async () => {
        const res = await post({ ...completeProduct, brand: null });
        expect(res.status).toBe(201);
        expect(convex.mutation.mock.calls[0][1]).toMatchObject({ brand: null });
    });

    it('leaves untouched fields out of the patch', async () => {
        const res = await patch({ variants: [completeVariant] });
        expect(res.status).toBe(200);
        const args = convex.mutation.mock.calls[0][1];
        expect(args.title).toBeUndefined();
        expect(args.brand).toBeUndefined();
        expect(args.galleryImages).toBeUndefined();
    });

    it('rejects a present but blank title or category instead of blanking the listing', async () => {
        expect((await patch({ title: '   ' })).status).toBe(400);
        expect((await patch({ category: '' })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON and non-object bodies', async () => {
        expect((await patch(undefined, { rawBody: '{' })).status).toBe(400);
        expect((await patch(null)).status).toBe(400);
        expect((await patch('nope')).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('rejects fields of the wrong type rather than passing them to Convex', async () => {
        expect((await patch({ brand: 42 })).status).toBe(400);
        expect((await patch({ gallery_images: ['ok', 7] })).status).toBe(400);
        expect((await patch({ specifications: ['nope'] })).status).toBe(400);
        expect((await patch({ variants: 'nope' })).status).toBe(400);
        expect((await patch({ is_active: 'yes' })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    // NaN survives `typeof x === 'number'` and Convex's `v.number()`, so an
    // unparseable price would otherwise be written to the database.
    it('rejects a variant price that is not a finite number', async () => {
        expect((await patch({ variants: [{ ...completeVariant, price: 'abc' }] })).status).toBe(400);
        expect((await patch({ variants: [{ ...completeVariant, weight_kg: 'heavy' }] })).status).toBe(400);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('converts euros to cents and keeps unset shipping data null', async () => {
        await patch({ variants: [{ ...completeVariant, weight_kg: null, shipping_cost: null }] });
        expect(variantsSentToConvex()[0]).toMatchObject({
            priceCents: 499,
            stock: 9,
            weightKg: null,
            shippingCostCents: null,
        });
    });

    it('derives a slug on creation but never invents one on a patch', async () => {
        await post({ ...completeProduct, slug: undefined, title: 'Mando Pro 2' });
        expect(convex.mutation.mock.calls[0][1].slug).toBe('mando-pro-2');

        convex.mutation.mockClear();
        await patch({ description: 'Updated' });
        expect(convex.mutation.mock.calls[0][1].slug).toBeUndefined();
    });

    it('surfaces a duplicate slug as a conflict', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Product slug already in use'));
        const res = await patch(completeProduct);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: en.sellerProductSlugInUse });
    });

    it("surfaces another seller's product as forbidden", async () => {
        convex.mutation.mockRejectedValueOnce(new Error('Product access denied'));
        expect((await patch(completeProduct)).status).toBe(403);
    });

    it('refuses to publish variants that would lose money on shipping', async () => {
        enforceVariantPricing.mockResolvedValueOnce({ ok: false, errors: ['too cheap'] });
        const res = await patch(completeProduct);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'too cheap' });
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('skips the loss check for a product that stays unpublished', async () => {
        convex.query.mockResolvedValue({ allowLoss: false, isActive: false, variants: [] });
        const res = await patch({ variants: [completeVariant] });
        expect(res.status).toBe(200);
        expect(enforceVariantPricing).not.toHaveBeenCalled();
    });
});
