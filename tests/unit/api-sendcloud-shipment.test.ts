import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

const { mockCreateShipment, mockNotify, mockUploadLabelPdf } = vi.hoisted(() => ({
    mockCreateShipment: vi.fn(),
    mockNotify: vi.fn(),
    mockUploadLabelPdf: vi.fn(),
}));

vi.mock('astro:env/server', () => ({
    CONVEX_WEBHOOK_SECRET: 'test-convex-secret',
    SENDCLOUD_API_KEY: 'test-sendcloud-key',
    SENDCLOUD_API_SECRET: 'test-sendcloud-secret',
}));

vi.mock('../../src/lib/core/auth', () => convex.authModule());
vi.mock('../../src/lib/core/env', () => ({ isDevelopment: false }));
vi.mock('../../src/lib/notifications/dispatch', () => ({ notify: mockNotify }));
vi.mock('../../src/lib/shipping/labelStorage', () => ({ uploadLabelPdf: mockUploadLabelPdf }));
vi.mock('../../src/lib/shipping/sendcloud', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/lib/shipping/sendcloud')>(),
    createShipment: mockCreateShipment,
}));

const { SendcloudAnnouncementError } = await import('../../src/lib/shipping/sendcloud');
const { POST } = await import('../../src/pages/api/sendcloud/shipment');

const shipmentContext = {
    orderId: 'convex:ORD-TEST',
    publicId: 'ORD-TEST',
    status: 'paid',
    buyerEmail: 'buyer@example.test',
    shippingFullName: 'Buyer Example',
    shippingPhone: '+34600000001',
    shippingAddress: 'Buyer Street 2, 08001 Barcelona',
    deliveryType: 'home',
    pickupPointId: null,
    pickupPointName: null,
    pickupPointAddress: null,
    pickupPointPostalCode: null,
    pickupPointCity: null,
    pickupPointCarrier: null,
    shop: { name: 'Example Shop', contactEmail: 'shop@example.test' },
    owner: {
        firstName: 'Seller',
        lastName: 'Example',
        phone: '600000000',
        phonePrefix: '+34',
        email: 'seller@example.test',
        addressStreet: 'Seller Street',
        addressNumber: '1',
        addressFloor: null,
        addressPostalCode: '28001',
        addressCity: 'Madrid',
        addressCountry: 'ES',
    },
    items: [{
        quantity: 1,
        weightKg: 0.4,
        lengthCm: 25,
        widthCm: 20,
        heightCm: 10,
        shippingCostCents: 349,
    }],
    shipment: null,
};

function call() {
    const request = new Request('https://fewya.com/api/sendcloud/shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: 'convex:ORD-TEST',
            shippingOptionCode: 'inpost_es:service_point,national_c2c',
            labelCost: 2.24,
        }),
    });
    return POST({ locals: { t: en, locale: 'en' }, request } as never);
}

describe('POST /api/sendcloud/shipment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
        convex.query.mockResolvedValue(shipmentContext);
    });

    it('returns 422 and never persists a carrier-rejected shipment', async () => {
        mockCreateShipment.mockRejectedValueOnce(
            new SendcloudAnnouncementError('Parcel dimensions were rejected'),
        );

        const response = await call();

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({
            error: 'Sendcloud rejected the shipment: Parcel dimensions were rejected',
        });
        expect(convex.mutation).not.toHaveBeenCalled();
        expect(mockUploadLabelPdf).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });
});
