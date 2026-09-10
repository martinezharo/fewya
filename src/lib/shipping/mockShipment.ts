import type { Strings } from '../core/i18n';
import { generateMockShippingLabel } from './shippingLabelPdf';
import { parseSpanishAddress } from './sendcloud';
import { uploadLabelPdf } from './labelStorage';
import { DELIVERY_TYPE } from '../orders/orderStatus';

export interface MockShipmentSuccess {
    success: true;
    shipmentId: string;
    trackingNumber: string;
    trackingUrl: string;
    labelUrl: string;
    carrierName: string;
}

export interface MockShipmentFailure {
    success: false;
    status: number;
    error: string;
}

export type MockShipmentResult = MockShipmentSuccess | MockShipmentFailure;

/** The subset of an order returned by Convex for the staged shipment path. */
export interface ConvexShipmentContext {
    orderId: string;
    publicId: string;
    buyerEmail: string | null;
    deliveryType: 'home' | 'pickup_point' | null;
    shippingFullName: string | null;
    shippingPhone: string | null;
    shippingAddress: string | null;
    pickupPointId: string | null;
    pickupPointName: string | null;
    pickupPointAddress: string | null;
    pickupPointPostalCode: string | null;
    pickupPointCity: string | null;
    pickupPointCarrier: string | null;
    shop: { name: string; contactEmail: string | null };
    owner: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        phonePrefix: string | null;
        email: string;
        addressStreet: string | null;
        addressNumber: string | null;
        addressFloor: string | null;
        addressPostalCode: string | null;
        addressCity: string | null;
        addressCountry: string | null;
    };
    items: Array<{
        quantity: number;
        weightKg: number | null;
        lengthCm: number | null;
        widthCm: number | null;
        heightCm: number | null;
    }>;
}

export interface PersistConvexShipmentInput {
    orderId: string;
    sendcloudShipmentId: string;
    sendcloudReference: string;
    carrierId: string;
    carrierName: string;
    serviceName: string;
    priceCents: number;
    currency: string;
    trackingNumber: string;
    trackingUrl: string;
    labelUrl: string;
}

/**
 * Generates the local development label for an order. The PDF goes to Convex
 * Storage; the order and shipment state is committed atomically in Convex by
 * the `persist` callback.
 */
export async function runMockShipment(params: {
    context: ConvexShipmentContext;
    labelCost: number;
    t: Strings;
    request: Request;
    persist: (input: PersistConvexShipmentInput) => Promise<void>;
}): Promise<MockShipmentResult> {
    const { context, labelCost, t, request, persist } = params;
    const owner = context.owner;
    const shop = context.shop;
    const isPickup = context.deliveryType === DELIVERY_TYPE.PICKUP_POINT;

    const senderStreet = [owner.addressStreet, owner.addressNumber, owner.addressFloor]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(' ');
    const senderName = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || shop.name;
    const senderCity = owner.addressCity ?? '';
    const senderPostal = owner.addressPostalCode ?? '';
    const senderCountry = owner.addressCountry || 'ES';
    const senderPhone = owner.phone
        ? `${owner.phonePrefix ?? '+34'}${owner.phone}`.replace(/\s+/g, '')
        : '';
    if (!senderStreet || !senderCity || !senderPostal || !senderName || !senderPhone) {
        return { success: false, status: 400, error: 'Completa los datos del vendedor antes de generar etiquetas' };
    }

    const recipientName = context.shippingFullName || 'Cliente';
    let recipientAddress = context.shippingAddress || '';
    let recipientCity = '';
    let recipientPostalCode = '';
    if (isPickup && context.pickupPointAddress) {
        const parsed = parseSpanishAddress(context.pickupPointAddress);
        recipientAddress = parsed.street || context.pickupPointAddress;
        recipientCity = parsed.city || context.pickupPointCity || '';
        recipientPostalCode = parsed.postalCode || context.pickupPointPostalCode || '';
    } else {
        const parsed = parseSpanishAddress(context.shippingAddress || '');
        recipientAddress = parsed.street || context.shippingAddress || '';
        recipientCity = parsed.city || '';
        recipientPostalCode = parsed.postalCode || '';
    }

    const carrierName = isPickup
        ? (context.pickupPointCarrier?.toLowerCase().includes('inpost') ? 'InPost' : 'Correos')
        : 'Correos';
    const serviceName = isPickup
        ? (carrierName === 'InPost' ? 'Punto Pack' : 'Punto de Recogida')
        : 'Envio a Domicilio (Paquete Azul)';
    const mockShipmentId = `MOCK-${Date.now()}`;
    const mockTracking = `TEST${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const trackingUrl = `https://track.${carrierName.toLowerCase().replace(/\s/g, '')}.com/?tracking=${mockTracking}`;

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = await generateMockShippingLabel({
            orderPublicId: context.publicId,
            senderName,
            senderAddress: senderStreet,
            senderCity,
            senderPostalCode: senderPostal,
            senderCountry,
            senderPhone,
            recipientName,
            recipientAddress,
            recipientCity,
            recipientPostalCode,
            recipientCountry: 'ES',
            recipientPhone: context.shippingPhone || '',
            carrierName,
            serviceName,
            trackingNumber: mockTracking,
            isPickupPoint: isPickup,
            pickupPointName: isPickup ? context.pickupPointName ?? undefined : undefined,
        });
    } catch (error) {
        console.error('mock Convex shipment: PDF generation failed', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    let labelUrl: string;
    try {
        labelUrl = (await uploadLabelPdf(pdfBytes, request)).marker;
    } catch (error) {
        console.error('mock Convex shipment: storage error', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    try {
        await persist({
            orderId: context.orderId,
            sendcloudShipmentId: mockShipmentId,
            sendcloudReference: `REF-${context.publicId}`,
            carrierId: carrierName.toLowerCase(),
            carrierName,
            serviceName,
            priceCents: Math.round(labelCost * 100),
            currency: 'EUR',
            trackingNumber: mockTracking,
            trackingUrl,
            labelUrl,
        });
    } catch (error) {
        console.error('mock Convex shipment: state persistence failed', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    return {
        success: true,
        shipmentId: mockShipmentId,
        trackingNumber: mockTracking,
        trackingUrl,
        labelUrl: `/api/sendcloud/label?shipmentId=${encodeURIComponent(mockShipmentId)}`,
        carrierName,
    };
}
