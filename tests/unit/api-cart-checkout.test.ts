import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const mockGetUser = vi.fn();
const mockProfileSingle = vi.fn();
const mockVariantsIn = vi.fn();
const mockAdminRpc = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionExpire = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({
        auth: { getUser: mockGetUser },
        from: (table: string) => {
            if (table === 'profiles') {
                return { select: () => ({ eq: () => ({ single: mockProfileSingle }) }) };
            }
            // product_variants
            return { select: () => ({ in: mockVariantsIn }) };
        },
    }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({ rpc: mockAdminRpc }),
}));

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
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const completeProfile = {
    first_name: 'Ana',
    last_name: 'García',
    email: 'ana@example.com',
    phone: '600111222',
    phone_prefix: '+34',
    address_street: 'Calle Mayor',
    address_number: '1',
    address_floor: '',
    address_postal_code: '28001',
    address_city: 'Madrid',
    address_province: 'Madrid',
    address_country: 'ES',
};

function paymentAccount(overrides: Record<string, unknown> = {}) {
    return {
        stripe_account_id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        ...overrides,
    };
}

function shop(overrides: Record<string, unknown> = {}) {
    return {
        id: 'shop-1',
        name: 'Shop One',
        slug: 'shop-one',
        is_active: true,
        seller_details_complete: true,
        shipping_carriers: ['correos', 'inpost'],
        shop_payment_accounts: paymentAccount(),
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
        products: {
            id: 'prod-1',
            title: 'Widget',
            slug: 'widget',
            is_active: true,
            gallery_images: ['img.jpg'],
            shops: shop(),
            ...productOverrides,
        },
        ...overrides,
    };
}

describe('POST /api/cart/checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1', email: 'ana@example.com', user_metadata: {} } } });
        mockProfileSingle.mockResolvedValue({ data: completeProfile, error: null });
        mockVariantsIn.mockResolvedValue({ data: [variantRow()], error: null });
        mockAdminRpc.mockResolvedValue({ data: [{ id: 'order-uuid-1' }], error: null });
        mockSessionCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/session/cs_1' });
        mockSessionExpire.mockResolvedValue({});
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
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

    it('returns 400 with a profile-completion redirect when the profile is incomplete', async () => {
        mockProfileSingle.mockResolvedValueOnce({ data: { ...completeProfile, phone: null }, error: null });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload.redirectTo).toContain('/me/details');
        expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when the variant lookup fails', async () => {
        mockVariantsIn.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        expect((await call({ items: [{ variantId: 'var-1', quantity: 1 }] })).status).toBe(500);
    });

    it('returns 400 when a variant cannot be resolved', async () => {
        mockVariantsIn.mockResolvedValueOnce({ data: [], error: null });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutProductUnavailable });
    });

    it('returns 400 when the product is inactive', async () => {
        mockVariantsIn.mockResolvedValueOnce({ data: [variantRow({}, { is_active: false })], error: null });
        expect((await call({ items: [{ variantId: 'var-1', quantity: 1 }] })).status).toBe(400);
    });

    it('returns an out-of-stock error when the quantity exceeds stock', async () => {
        mockVariantsIn.mockResolvedValueOnce({ data: [variantRow({ stock: 1 })], error: null });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 2 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutOutOfStock });
    });

    it('returns 400 when the seller payment account is not chargeable', async () => {
        mockVariantsIn.mockResolvedValueOnce({
            data: [variantRow({}, { shops: shop({ shop_payment_accounts: paymentAccount({ charges_enabled: false }) }) })],
            error: null,
        });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutSellerNotReady });
    });

    it('returns 400 when seller details are incomplete', async () => {
        mockVariantsIn.mockResolvedValueOnce({
            data: [variantRow({}, { shops: shop({ seller_details_complete: false }) })],
            error: null,
        });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: en.apiCheckoutSellerNotReady });
    });

    it('returns 400 when a shop does not support the chosen delivery platform', async () => {
        mockVariantsIn.mockResolvedValueOnce({
            data: [variantRow({}, { shops: shop({ shipping_carriers: ['inpost'] }) })],
            error: null,
        });
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
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('expires the Stripe session and returns 500 when order creation fails', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
        const res = await call({ items: [{ variantId: 'var-1', quantity: 1 }] });
        expect(res.status).toBe(500);
        expect(mockSessionExpire).toHaveBeenCalledWith('cs_1');
        expect(await res.json()).toMatchObject({ error: en.apiOrderCreateError });
    });

    it('creates one order per shop and returns the checkout URL on the happy path', async () => {
        const shopTwo = shop({ id: 'shop-2', name: 'Shop Two', slug: 'shop-two' });
        mockVariantsIn.mockResolvedValueOnce({
            data: [
                variantRow(),
                variantRow({ id: 'var-2', price: 10, shipping_cost: 5 }, { id: 'prod-2', title: 'Gadget', slug: 'gadget', shops: shopTwo }),
            ],
            error: null,
        });
        mockAdminRpc
            .mockResolvedValueOnce({ data: [{ id: 'order-uuid-1' }], error: null })
            .mockResolvedValueOnce({ data: [{ id: 'order-uuid-2' }], error: null });

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

        expect(mockAdminRpc).toHaveBeenCalledTimes(2);
        // shop-1: 2 × 20 + 3 shipping
        expect(mockAdminRpc).toHaveBeenNthCalledWith(1, 'create_checkout_order', expect.objectContaining({
            p_buyer_id: 'buyer-1',
            p_shop_id: 'shop-1',
            p_total_amount: 43,
            p_currency: 'eur',
            p_stripe_checkout_session_id: 'cs_1',
            p_delivery_type: 'home',
            p_items: [{ variant_id: 'var-1', quantity: 2, price_at_purchase: 20 }],
        }));
        // shop-2: 1 × 10 + 5 shipping
        expect(mockAdminRpc).toHaveBeenNthCalledWith(2, 'create_checkout_order', expect.objectContaining({
            p_shop_id: 'shop-2',
            p_total_amount: 15,
        }));
        expect(mockSessionExpire).not.toHaveBeenCalled();
    });

    it('uses the max shipping cost per shop when a shop has several items', async () => {
        mockVariantsIn.mockResolvedValueOnce({
            data: [
                variantRow({ shipping_cost: 3 }),
                variantRow({ id: 'var-2', price: 10, shipping_cost: 7 }, { id: 'prod-2', title: 'Gadget', slug: 'gadget' }),
            ],
            error: null,
        });

        const res = await call({
            items: [
                { variantId: 'var-1', quantity: 1 },
                { variantId: 'var-2', quantity: 1 },
            ],
        });

        expect(res.status).toBe(200);
        // One shop → a single order. Total = 20 + 10 + max(3, 7) shipping.
        expect(mockAdminRpc).toHaveBeenCalledTimes(1);
        expect(mockAdminRpc).toHaveBeenCalledWith('create_checkout_order', expect.objectContaining({
            p_total_amount: 37,
        }));
    });

    it('stores the pickup point address on the order for pickup deliveries', async () => {
        const res = await call({
            items: [{ variantId: 'var-1', quantity: 1 }],
            delivery: {
                type: 'pickup_point',
                pickupPointId: 'pp-1',
                pickupPointName: 'Locker 42',
                pickupPointAddress: 'Calle Falsa 123',
                pickupPointCarrier: 'inpost',
            },
        });

        expect(res.status).toBe(200);
        expect(mockAdminRpc).toHaveBeenCalledWith('create_checkout_order', expect.objectContaining({
            p_delivery_type: 'pickup_point',
            p_pickup_point_id: 'pp-1',
            p_shipping_address: 'Calle Falsa 123',
        }));
    });
});
