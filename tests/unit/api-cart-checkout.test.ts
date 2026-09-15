import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';
import { getFunctionName } from 'convex/server';
import { api } from '../../convex/_generated/api';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});
const { mockSessionCreate, mockSessionExpire } = vi.hoisted(() => ({
    mockSessionCreate: vi.fn(),
    mockSessionExpire: vi.fn(),
}));

vi.mock('../../src/lib/core/auth', () => convex.authModule());

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({
        checkout: { sessions: { create: mockSessionCreate, expire: mockSessionExpire } },
    }),
    buildAbsoluteUrl: (_request: Request, path: string) => `https://fewya.com${path}`,
}));

const { POST } = await import('../../src/pages/api/cart/checkout');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as any);
}

/** The Convex profile document for a buyer who can check out. */
const completeProfile = {
    firstName: 'Ana',
    lastName: 'García',
    email: 'ana@example.com',
    phone: '600111222',
    phonePrefix: '+34',
    addressStreet: 'Calle Mayor',
    addressNumber: '1',
    addressFloor: '',
    addressPostalCode: '28001',
    addressCity: 'Madrid',
    addressProvince: 'Madrid',
    addressCountry: 'ES',
};

function shop(overrides: Record<string, unknown> = {}) {
    return {
        id: 'shop-1',
        name: 'Shop One',
        slug: 'shop-one',
        is_active: true,
        seller_details_complete: true,
        shipping_carriers: ['correos', 'inpost'],
        payment_ready: true,
        ...overrides,
    };
}

function variantRow(overrides: Record<string, unknown> = {}, productOverrides: Record<string, unknown> = {}) {
    return {
        id: 'var-1',
        price: 20,
        stock: 5,
        variant_name: 'Red',
        variant_image: null,
        shipping_cost: 3,
        product: {
            id: 'prod-1',
            title: 'Widget',
            slug: 'widget',
            is_active: true,
            gallery_images: ['img.jpg'],
            shop: shop(),
            ...productOverrides,
        },
        ...overrides,
    };
}

/** Routes the two Convex reads the checkout performs. */
function stubReads({ profile = completeProfile, variants = [variantRow()] }: {
    profile?: Record<string, unknown> | null;
    variants?: unknown[];
} = {}) {
    convex.query.mockImplementation(async (fn: any) => {
        const name = getFunctionName(fn);
        if (name === getFunctionName(api.users.current)) return profile;
        if (name === getFunctionName(api.catalog.getCartVariants)) return variants;
        throw new Error(`unexpected query: ${name}`);
    });
}

describe('POST /api/cart/checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        stubReads();
        convex.mutation.mockResolvedValue({
            orders: [{ id: 'convex:ORD-1', public_id: 'ORD-1', shop_id: 'shop-1' }],
        });
        mockSessionCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/session/cs_1' });
        mockSessionExpire.mockResolvedValue({});
    });

    it('returns 401 when there is no authenticated user', async () => {
        convex.reset(null);
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(401);
        expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed JSON', async () => {
        expect((await call(null, { rawBody: '{oops' })).status).toBe(400);
    });

    it('returns 400 when the cart is empty', async () => {
        expect((await call({ items: [] })).status).toBe(400);
    });

    it('returns 400 when an item has an invalid quantity', async () => {
        const res = await call({ items: [{ variantId: 'var-1', quantity: 0 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiInvalidProductData });
    });

    it('returns 401 when the caller has no linked profile', async () => {
        stubReads({ profile: null });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(401);
        expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 400 with a profile-completion redirect when the profile is incomplete', async () => {
        stubReads({ profile: { ...completeProfile, phone: null } });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload.redirectTo).toContain('/me/details');
        expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when the variant lookup fails', async () => {
        convex.query.mockImplementation(async (fn: any) => {
            if (getFunctionName(fn) === getFunctionName(api.users.current)) return completeProfile;
            throw new Error('convex down');
        });
        expect((await call({ items: [{ variantId: 'var-1', quantity: 1 }] })).status).toBe(500);
    });

    it('returns 400 when a variant cannot be resolved', async () => {
        stubReads({ variants: [] });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutProductUnavailable });
    });

    it('returns 400 when the product is inactive', async () => {
        stubReads({ variants: [variantRow({}, { is_active: false })] });
        expect((await call({ items: [{ variantId: 'var-1', quantity: 1 }] })).status).toBe(400);
    });

    it('returns an out-of-stock error when the quantity exceeds stock', async () => {
        stubReads({ variants: [variantRow({ stock: 1 })] });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 2 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutOutOfStock });
    });

    it('returns 400 when the shop cannot be paid', async () => {
        stubReads({ variants: [variantRow({}, { shop: shop({ payment_ready: false }) })] });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutSellerNotReady });
    });

    it('returns 400 when seller details are incomplete', async () => {
        stubReads({ variants: [variantRow({}, { shop: shop({ seller_details_complete: false }) })] });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutSellerNotReady });
    });

    it('returns 400 when a shop does not support the chosen delivery platform', async () => {
        stubReads({ variants: [variantRow({}, { shop: shop({ shipping_carriers: ['inpost'] }) })] });
        const res = await call({
            items: [{ variantId: 'var-1', quantity: 1 }],
            delivery: { type: 'home' },
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutCarrierUnavailable });
        expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when the Stripe session cannot be created', async () => {
        mockSessionCreate.mockRejectedValueOnce(new Error('stripe down'));
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(500);
        expect(convex.mutation).not.toHaveBeenCalled();
    });

    it('never sends or stores a placeholder email at the Stripe boundary', async () => {
        convex.reset({ id: 'buyer-without-email', email: 'clerk-buyer-without-email@invalid.local' });
        stubReads({ profile: { ...completeProfile, email: 'clerk-imported@invalid.local' } });
        convex.mutation.mockResolvedValue({
            orders: [{ id: 'convex:ORD-1', public_id: 'ORD-1', shop_id: 'shop-1' }],
        });

        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });

        expect(res.status).toBe(200);
        expect(mockSessionCreate.mock.calls[0][0].customer_email).toBeUndefined();
        const [, mutationArgs] = convex.mutation.mock.calls[0] as [unknown, any];
        expect(mutationArgs.orders[0].buyerEmail).toBeUndefined();
    });

    it('expires the Stripe session and returns 500 when order creation fails', async () => {
        convex.mutation.mockRejectedValueOnce(new Error('write failed'));
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(500);
        expect(mockSessionExpire).toHaveBeenCalledWith('cs_1');
        expect(await res.json()).toMatchObject({ error: en.apiOrderCreateError });
    });

    it('creates one order per shop in a single atomic write on the happy path', async () => {
        const shopTwo = shop({ id: 'shop-2', name: 'Shop Two', slug: 'shop-two' });
        stubReads({
            variants: [
                variantRow(),
                variantRow({ id: 'var-2', price: 10, shipping_cost: 5 }, { id: 'prod-2', title: 'Gadget', slug: 'gadget', shop: shopTwo }),
            ],
        });
        convex.mutation.mockResolvedValueOnce({
            orders: [
                { id: 'convex:ORD-1', public_id: 'ORD-1', shop_id: 'shop-1' },
                { id: 'convex:ORD-2', public_id: 'ORD-2', shop_id: 'shop-2' },
            ],
        });

        const res = await call({
            items: [
                { variantId: 'var-1', quantity: 2 },
                { variantId: 'var-2', quantity: 1 },
            ],
        });

        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.checkoutUrl).toBe('https://stripe.test/session/cs_1');
        expect(payload.orders).toHaveLength(2);

        // One mutation for the whole checkout: partial order creation is what
        // the atomic Convex write exists to prevent.
        expect(convex.mutation).toHaveBeenCalledTimes(1);
        const [, args] = convex.mutation.mock.calls[0] as [unknown, any];
        expect(args.stripeCheckoutSessionId).toBe('cs_1');
        expect(args.currency).toBe('eur');
        // shop-1: 2 × 20 + 3 shipping; shop-2: 1 × 10 + 5 shipping
        expect(args.orders[0]).toMatchObject({ shopLegacyId: 'shop-1', totalAmountCents: 4300, deliveryType: 'home' });
        expect(args.orders[0].items).toEqual([
            { variantLegacyId: 'var-1', quantity: 2, priceAtPurchaseCents: 2000, shippingCostAtPurchaseCents: 300 },
        ]);
        expect(args.orders[1]).toMatchObject({ shopLegacyId: 'shop-2', totalAmountCents: 1500 });
        expect(mockSessionExpire).not.toHaveBeenCalled();
    });

    it('uses the max shipping cost per shop when a shop has several items', async () => {
        stubReads({
            variants: [
                variantRow({ id: 'var-1', shipping_cost: 3 }),
                variantRow({ id: 'var-2', price: 10, shipping_cost: 7 }, { id: 'prod-2', slug: 'gadget' }),
            ],
        });
        await call({
            items: [
                { variantId: 'var-1', quantity: 1 },
                { variantId: 'var-2', quantity: 1 },
            ],
        });
        const [, args] = convex.mutation.mock.calls[0] as [unknown, any];
        // 20 + 10 + max(3, 7)
        expect(args.orders[0].totalAmountCents).toBe(3700);
    });

    it('stores the pickup point address on the order for pickup deliveries', async () => {
        await call({
            items: [{ variantId: 'var-1', quantity: 1 }],
            delivery: {
                type: 'pickup_point',
                pickupPointId: 'sp-1',
                pickupPointName: 'Correos Sol',
                pickupPointAddress: 'Puerta del Sol 1, 28013 Madrid',
                pickupPointCarrier: 'correos',
            },
        });
        const [, args] = convex.mutation.mock.calls[0] as [unknown, any];
        expect(args.orders[0]).toMatchObject({
            deliveryType: 'pickup_point',
            pickupPointId: 'sp-1',
            shippingAddress: 'Puerta del Sol 1, 28013 Madrid',
        });
    });
});
