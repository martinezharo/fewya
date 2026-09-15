import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateParcelFromItems,
    createShipment,
    downloadSendcloudLabelPdf,
    getServicePoints,
    parseSpanishAddress,
} from '../../src/lib/shipping/sendcloud';
import announceReady from '../fixtures/sendcloud/announce-ready.json';
import announceFailed from '../fixtures/sendcloud/announce-failed.json';

describe('createShipment', () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SENDCLOUD_API_KEY;
    const originalSecret = process.env.SENDCLOUD_API_SECRET;

    const shipment = (overrides: Record<string, unknown> = {}) => ({
        data: {
            id: 'shipment-1',
            parcels: [{
                id: 123,
                tracking_number: 'TRACK-1',
                tracking_url: 'https://tracking.sendcloud.sc/123',
                status: { code: 'READY_TO_SEND', message: 'Ready to send' },
                documents: [{ type: 'label', link: 'https://panel.sendcloud.sc/api/v2/parcels/123/documents/label' }],
                ...overrides,
            }],
            errors: [],
        },
    });

    const input = (shippingOptionCode: string) => ({
        orderId: 'ORD-TEST',
        senderName: 'Seller Example',
        senderAddress: 'Seller Street 1',
        senderCity: 'Madrid',
        senderPostalCode: '28001',
        senderCountry: 'ES',
        senderPhone: '+34600000000',
        senderEmail: 'seller@example.test',
        recipientName: 'Buyer Example',
        recipientAddress: 'Buyer Street 2',
        recipientCity: 'Barcelona',
        recipientPostalCode: '08001',
        recipientCountry: 'ES',
        recipientPhone: '+34600000001',
        recipientEmail: 'buyer@example.test',
        parcels: [{ weight: 0.4, length: 25, width: 20, height: 10 }],
        requestedService: { shippingOptionCode },
        toServicePointId: '12345',
    });

    beforeEach(() => {
        process.env.SENDCLOUD_API_KEY = 'test-key';
        process.env.SENDCLOUD_API_SECRET = 'test-secret';
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.SENDCLOUD_API_KEY;
        else process.env.SENDCLOUD_API_KEY = originalKey;
        if (originalSecret === undefined) delete process.env.SENDCLOUD_API_SECRET;
        else process.env.SENDCLOUD_API_SECRET = originalSecret;
        vi.restoreAllMocks();
    });

    it('accepts the anonymized HTTP 201 contract fixture only when it contains a label', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => announceReady,
        } as Response);

        await expect(createShipment(input('correos:home,national'))).resolves.toMatchObject({
            shipmentId: '900001',
            trackingNumber: 'TEST-TRACKING-READY',
            labelUrl: 'https://panel.sendcloud.sc/api/v2/parcels/900001/documents/label',
        });
    });

    it.each([
        {
            name: 'InPost service point',
            code: 'inpost_es:service_point,national_c2c',
            servicePointId: '12345',
            dimensions: undefined,
            servicePoint: { id: '12345' },
        },
        {
            name: 'Correos service point',
            code: 'correos:service_point,national',
            servicePointId: '54321',
            dimensions: { length: '25', width: '20', height: '10', unit: 'cm' },
            servicePoint: { id: '54321' },
        },
        {
            name: 'Correos home delivery',
            code: 'correos:home,national',
            servicePointId: undefined,
            dimensions: { length: '25', width: '20', height: '10', unit: 'cm' },
            servicePoint: undefined,
        },
    ])('builds the carrier-specific payload for $name', async ({ code, servicePointId, dimensions, servicePoint }) => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => announceReady,
        } as Response);

        await createShipment({ ...input(code), toServicePointId: servicePointId });

        const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
        const payload = JSON.parse(String(request?.body));
        expect(payload.parcels[0].weight).toEqual({ value: '0.400', unit: 'kg' });
        expect(payload.parcels[0].dimensions).toEqual(dimensions);
        expect(payload.to_service_point).toEqual(servicePoint);
    });

    it('rejects a carrier failure even when Sendcloud returns a successful HTTP status', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => announceFailed,
        } as Response);

        await expect(createShipment(input('inpost_es:service_point,national_c2c')))
            .rejects.toThrow('The carrier rejected the parcel dimensions');
    });

    it('treats a response without a parcel as an announcement failure', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                data: {
                    id: 'shipment-1',
                    parcels: [],
                    errors: [{ detail: 'Carrier returned no parcel' }],
                },
            }),
        } as Response);

        await expect(createShipment(input('correos:home,national')))
            .rejects.toMatchObject({
                name: 'SendcloudAnnouncementError',
                message: expect.stringContaining('Carrier returned no parcel'),
            });
    });

    it('does not accept a shipment without a label document', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => shipment({ documents: [] }),
        } as Response);

        await expect(createShipment(input('correos:home,national')))
            .rejects.toThrow('did not return a shipping label');
    });
});

describe('calculateParcelFromItems', () => {
    it('consolida varias unidades del mismo item en un único parcel apilado', () => {
        const items = [
            { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10, quantity: 2 },
        ];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        expect(parcels[0]).toEqual({ weight: 2, length: 20, width: 15, height: 20 });
    });

    it('usa valores por defecto cuando faltan dimensiones', () => {
        const items = [{ quantity: 1 }];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        expect(parcels[0]).toEqual({ weight: 0.5, length: 10, width: 10, height: 10 });
    });

    it('consolida múltiples items en un único paquete', () => {
        const items = [
            { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, quantity: 1 },
            { weightKg: 2, lengthCm: 20, widthCm: 20, heightCm: 20, quantity: 2 },
        ];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        // peso = 1 + 2*2 = 5; largo/ancho = max(10,20) = 20; alto = 10 + 20*2 = 50
        expect(parcels[0]).toEqual({ weight: 5, length: 20, width: 20, height: 50 });
    });

    it('devuelve array vacío si no hay items con cantidad', () => {
        expect(calculateParcelFromItems([])).toEqual([]);
        expect(calculateParcelFromItems([{ quantity: 0 }])).toEqual([]);
    });
});

describe('parseSpanishAddress', () => {
    it('extrae CP, calle y ciudad de dirección española típica', () => {
        const result = parseSpanishAddress('Calle Mayor 5, 28001, Madrid');
        expect(result.postalCode).toBe('28001');
        expect(result.city).toBe('Madrid');
        expect(result.street).toContain('Calle Mayor 5');
    });

    it('maneja dirección multilinea', () => {
        const result = parseSpanishAddress('Calle Gran Vía 12\n28013, Madrid');
        expect(result.postalCode).toBe('28013');
        expect(result.city).toBe('Madrid');
    });

    it('devuelve CP vacío si no encuentra código postal', () => {
        const result = parseSpanishAddress('Calle Falsa, Madrid');
        expect(result.postalCode).toBe('');
    });

    it('extrae el CP del nombre de la ciudad aunque vayan juntos', () => {
        const result = parseSpanishAddress('Calle Mayor 5, 28001 Madrid');
        expect(result.postalCode).toBe('28001');
        expect(result.city).toBe('Madrid');
    });

    it('limpia el CP que aparece pegado a la ciudad en direcciones multilínea', () => {
        const result = parseSpanishAddress('AVENIDA DE MALAGA 107\n29720 LA CALA DEL MORAL');
        expect(result.postalCode).toBe('29720');
        expect(result.city).toBe('LA CALA DEL MORAL');
        expect(result.street).toBe('AVENIDA DE MALAGA 107');
    });
});

describe('downloadSendcloudLabelPdf', () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SENDCLOUD_API_KEY;
    const originalSecret = process.env.SENDCLOUD_API_SECRET;

    beforeEach(() => {
        process.env.SENDCLOUD_API_KEY = 'test-key';
        process.env.SENDCLOUD_API_SECRET = 'test-secret';
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.SENDCLOUD_API_KEY;
        else process.env.SENDCLOUD_API_KEY = originalKey;
        if (originalSecret === undefined) delete process.env.SENDCLOUD_API_SECRET;
        else process.env.SENDCLOUD_API_SECRET = originalSecret;
        vi.restoreAllMocks();
    });

    // The request carries the Sendcloud API key and secret, and the URL comes
    // from a stored shipment row rather than from Sendcloud's own response,
    // so a tampered row must not be able to redirect those credentials.
    it('refuses to send the credentials to a non-Sendcloud host', async () => {
        const fetchMock = vi.mocked(globalThis.fetch);

        await expect(downloadSendcloudLabelPdf('https://attacker.example/collect'))
            .rejects.toThrow(/non-Sendcloud/i);
        await expect(downloadSendcloudLabelPdf('http://panel.sendcloud.sc/api/v2/labels/1'))
            .rejects.toThrow(/non-Sendcloud/i);
        // A host that merely *starts* with the Sendcloud domain is not it.
        await expect(downloadSendcloudLabelPdf('https://panel.sendcloud.sc.attacker.example/x'))
            .rejects.toThrow(/non-Sendcloud/i);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('descarga el PDF de Sendcloud con Basic auth y devuelve Uint8Array', async () => {
        const fakeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => fakeBytes.buffer,
        } as unknown as Response);

        const result = await downloadSendcloudLabelPdf('https://panel.sendcloud.sc/api/v3/docs/label/123');

        expect(result).toBeInstanceOf(Uint8Array);
        expect(Array.from(result)).toEqual(Array.from(fakeBytes));

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://panel.sendcloud.sc/api/v3/docs/label/123');
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toMatch(/^Basic /);
    });

    it('lanza error si Sendcloud responde con estado != 2xx', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
        } as unknown as Response);

        await expect(
            downloadSendcloudLabelPdf('https://panel.sendcloud.sc/api/v3/docs/label/123'),
        ).rejects.toThrow(/401 Unauthorized/);
    });
});

describe('getServicePoints', () => {
    const originalFetch = globalThis.fetch;
    const ADDRESS = 'Gran Via 1, 28013 Madrid';

    const point = (id: number, carrier: string) => ({
        id,
        name: `Point ${id}`,
        street: 'Gran Via',
        house_number: '38',
        postal_code: '28013',
        city: 'Madrid',
        latitude: '36.7',
        longitude: '-4.4',
        carrier,
        distance: 100,
        formatted_opening_times: {},
    });

    const okResponse = (points: unknown[]) => ({
        ok: true,
        json: async () => points,
    } as unknown as Response);

    const errorResponse = (status: number, body: string) => ({
        ok: false,
        status,
        statusText: 'Bad Request',
        text: async () => body,
    } as unknown as Response);

    const requestedUrl = (call: number) =>
        new URL(vi.mocked(globalThis.fetch).mock.calls[call][0] as string);

    beforeEach(() => {
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('asks sendcloud for inpost_es, the code its service points API accepts', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse([point(1, 'inpost_es')]));

        await getServicePoints(ADDRESS, 'ES', ['inpost']);

        expect(requestedUrl(0).searchParams.get('carrier')).toBe('inpost_es');
    });

    it('sends one comma-separated carrier param, since sendcloud keeps only the last repeated one', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse([]));

        await getServicePoints(ADDRESS, 'ES', ['inpost', 'correos']);

        const params = requestedUrl(0).searchParams;
        expect(params.getAll('carrier')).toEqual(['inpost_es,correos']);
    });

    it('omits the carrier filter when no platform is requested', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse([]));

        await getServicePoints(ADDRESS, 'ES', []);

        expect(requestedUrl(0).searchParams.has('carrier')).toBe(false);
    });

    it('maps the sendcloud payload to service points', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse([point(1, 'correos')]));

        const points = await getServicePoints(ADDRESS, 'ES', ['correos']);

        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ id: 1, houseNumber: '38', postalCode: '28013', carrier: 'correos' });
    });

    it('retries unfiltered when sendcloud rejects a carrier, keeping only enabled platforms', async () => {
        vi.mocked(globalThis.fetch)
            .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
                error: { message: 'carrier: "The following requested carriers do not support service point delivery and cannot be used: inpost"' },
            })))
            .mockResolvedValueOnce(okResponse([point(1, 'inpost_es'), point(2, 'correos'), point(3, 'seur')]));

        const points = await getServicePoints(ADDRESS, 'ES', ['inpost']);

        expect(requestedUrl(1).searchParams.has('carrier')).toBe(false);
        expect(points.map((p) => p.id)).toEqual([1]);
    });

    it('retries unfiltered when a carrier is not activated on the account', async () => {
        vi.mocked(globalThis.fetch)
            .mockResolvedValueOnce(errorResponse(400, "carriers haven't been activated"))
            .mockResolvedValueOnce(okResponse([point(1, 'inpost_es'), point(2, 'correos')]));

        const points = await getServicePoints(ADDRESS, 'ES', ['correos']);

        expect(points.map((p) => p.id)).toEqual([2]);
    });

    it('never hides points behind an unrelated sendcloud failure', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(errorResponse(401, 'Invalid credentials'));

        await expect(getServicePoints(ADDRESS, 'ES', ['correos'])).rejects.toThrow(/401/);
        expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    });
});
