import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateMockShippingLabel } from '../../src/lib/shipping/shippingLabelPdf';

const BASE_DATA = {
    orderPublicId: 'ORD-1234',
    senderName: 'Tienda Ejemplo',
    senderAddress: 'Calle Falsa 123',
    senderCity: 'Madrid',
    senderPostalCode: '28001',
    senderCountry: 'España',
    recipientName: 'Juan Pérez',
    recipientAddress: 'Avenida Siempre Viva 742',
    recipientCity: 'Barcelona',
    recipientPostalCode: '08001',
    recipientCountry: 'España',
    carrierName: 'Correos',
    serviceName: 'Estándar',
    trackingNumber: 'TRACK123456',
    isPickupPoint: false,
};

describe('generateMockShippingLabel', () => {
    it('produces a valid single-page PDF document', async () => {
        const bytes = await generateMockShippingLabel(BASE_DATA);

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(0);

        // %PDF magic header
        expect(bytes[0]).toBe(0x25);
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x44);
        expect(bytes[3]).toBe(0x46);

        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
        const page = doc.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBe(288);
        expect(height).toBe(432);
    });

    it('handles home delivery without optional phone numbers', async () => {
        const bytes = await generateMockShippingLabel({ ...BASE_DATA, isPickupPoint: false });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });

    it('handles a pickup point with a pickup point name', async () => {
        const bytes = await generateMockShippingLabel({
            ...BASE_DATA,
            isPickupPoint: true,
            pickupPointName: 'Locker InPost - Gran Vía',
        });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });

    it('handles a pickup point flagged true without a pickup point name', async () => {
        const bytes = await generateMockShippingLabel({
            ...BASE_DATA,
            isPickupPoint: true,
            pickupPointName: undefined,
        });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });

    it('includes sender and recipient phone numbers when provided', async () => {
        const bytes = await generateMockShippingLabel({
            ...BASE_DATA,
            senderPhone: '+34600000000',
            recipientPhone: '+34600000001',
        });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });

    it('wraps long addresses across multiple lines without throwing', async () => {
        const bytes = await generateMockShippingLabel({
            ...BASE_DATA,
            recipientAddress:
                'Calle Muy Larga Con Muchisimas Palabras Que Deberian Envolverse En Varias Lineas De Texto Dentro De La Etiqueta',
            senderAddress:
                'Otra Calle Extremadamente Larga Para Forzar El Ajuste De Texto En El Bloque Del Remitente',
        });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });

    it('handles a single-word address with no spaces to wrap', async () => {
        const bytes = await generateMockShippingLabel({
            ...BASE_DATA,
            recipientAddress: 'Calle',
        });
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
    });
});
