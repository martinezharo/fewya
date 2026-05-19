import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateParcelFromItems,
    downloadSendcloudLabelPdf,
    parseSpanishAddress,
} from '../../src/lib/shipping/sendcloud';

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
