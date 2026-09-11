import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

vi.mock('../../src/lib/core/auth', () => convex.authModule());
vi.mock('../../src/lib/products/pricingEnforcement', () => ({
    enforceVariantPricing: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));

const shipping = await import('../../src/pages/api/sell/settings/shipping');
const shopUpdate = await import('../../src/pages/api/sell/shop/update');
const catalogToggle = await import('../../src/pages/api/sell/catalog/toggle');
const reviewReply = await import('../../src/pages/api/sell/reviews/reply');
const wishlistToggle = await import('../../src/pages/api/wishlist/toggle');

function send(
    handler: (context: any) => Promise<Response> | Response,
    { body, rawBody, path = 'https://fewya.com/api/x', method = 'POST' }:
        { body?: unknown; rawBody?: string; path?: string; method?: string },
) {
    const url = new URL(path);
    const request = new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return handler({ locals: { t: en, locale: 'en' }, request, url });
}

/**
 * Every one of these used to reach Convex, where a rejected argument surfaced
 * to the seller as an opaque 500 — or, for the numeric shop defaults, was
 * accepted as NaN and stored.
 */
describe('seller request bodies are validated before they reach Convex', () => {
    beforeEach(() => {
        convex.reset();
        convex.query.mockResolvedValue({ allowLoss: true, isActive: false, variants: [] });
        convex.mutation.mockResolvedValue({ ok: true, product: null });
    });

    describe('PATCH /api/sell/settings/shipping', () => {
        const call = (body: unknown) => send(shipping.PATCH, { body, method: 'PATCH' });

        it('rejects a dimension that is not a number instead of storing NaN', async () => {
            expect((await call({ default_weight_kg: 'heavy' })).status).toBe(400);
            expect((await call({ default_shipping_cost: 'free' })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('treats a blank value as "leave the default alone"', async () => {
            const res = await call({ default_weight_kg: '', default_length_cm: 30 });
            expect(res.status).toBe(200);
            expect(convex.mutation.mock.calls[0][1]).toMatchObject({
                defaultWeightKg: undefined,
                defaultLengthCm: 30,
            });
        });

        it('rejects a body that is not an object', async () => {
            expect((await send(shipping.PATCH, { rawBody: '{', method: 'PATCH' })).status).toBe(400);
            expect((await call(null)).status).toBe(400);
            // An array passes `typeof x === 'object'` and would read as a
            // no-op patch, answering 200 to a malformed request.
            expect((await call([])).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('rejects a dimension given as a boolean rather than coercing it', async () => {
            expect((await call({ default_weight_kg: true })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });
    });

    describe('PATCH /api/sell/shop/update', () => {
        const call = (body: unknown) => send(shopUpdate.PATCH, { body, method: 'PATCH' });

        it('rejects an image field that is not a string', async () => {
            expect((await call({ profile_img: 42 })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('rejects an image reference longer than the column allows', async () => {
            expect((await call({ banner_img: 'x'.repeat(513) })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('rejects an array body', async () => {
            expect((await call([])).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('still clears an image with an explicit null', async () => {
            const res = await call({ banner_img: null });
            expect(res.status).toBe(200);
            expect(convex.mutation.mock.calls[0][1]).toMatchObject({ bannerImg: null, profileImg: undefined });
        });
    });

    describe('PATCH /api/sell/catalog/toggle', () => {
        const call = (body: unknown) => send(catalogToggle.PATCH, {
            body,
            method: 'PATCH',
            path: 'https://fewya.com/api/sell/catalog/toggle?id=convex:product:1',
        });

        it('rejects a non-boolean is_active', async () => {
            expect((await call({ is_active: 'yes' })).status).toBe(400);
            expect((await call({})).status).toBe(400);
            expect((await call(null)).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('rejects an array body', async () => {
            expect((await call([])).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('toggles on a well-formed body', async () => {
            expect((await call({ is_active: false })).status).toBe(200);
            expect(convex.mutation.mock.calls[0][1]).toMatchObject({ isActive: false });
        });
    });

    describe('POST /api/sell/reviews/reply', () => {
        const call = (body: unknown) => send(reviewReply.POST, { body });

        it('rejects a reviewId that is not a string', async () => {
            expect((await call({ reviewId: 7, reply: 'thanks' })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('rejects a reply beyond the length the textarea allows', async () => {
            expect((await call({ reviewId: 'r1', reply: 'x'.repeat(2001) })).status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });

        it('accepts an empty reply, which clears the existing one', async () => {
            expect((await call({ reviewId: 'r1', reply: '' })).status).toBe(200);
            expect(convex.mutation.mock.calls[0][1]).toMatchObject({ reviewId: 'r1', reply: '' });
        });
    });

    describe('POST /api/wishlist/toggle', () => {
        it('answers 400 for malformed JSON rather than throwing', async () => {
            const res = await send(wishlistToggle.POST, { rawBody: '{' });
            expect(res.status).toBe(400);
            expect(convex.mutation).not.toHaveBeenCalled();
        });
    });
});
