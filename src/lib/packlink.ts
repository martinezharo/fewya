import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';

export const DEFAULT_SHOP_SHIPPING_EUR = 3.49;

export interface PacklinkConfig {
    apiKey: string;
    senderName: string;
    senderCompany?: string;
    senderAddress: string;
    senderCity: string;
    senderPostalCode: string;
    senderCountry: string;
    senderPhone: string;
    senderEmail: string;
}

export interface PacklinkShippingQuote {
    carrierId: string;
    carrierName: string;
    serviceName: string;
    price: number;
    currency: string;
    estimatedDays?: number;
    deliveryDate?: string;
}

export interface PacklinkParcel {
    weight: number;
    length: number;
    width: number;
    height: number;
}

export interface PacklinkShipmentData {
    orderId: string;
    senderName: string;
    senderCompany?: string;
    senderAddress: string;
    senderCity: string;
    senderPostalCode: string;
    senderCountry: string;
    senderPhone: string;
    senderEmail: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientPostalCode: string;
    recipientCountry: string;
    recipientPhone: string;
    recipientEmail: string;
    parcels: PacklinkParcel[];
    requestedService?: {
        carrierId: string;
        serviceName: string;
    };
}

export interface PacklinkShipmentResult {
    shipmentId: string;
    reference: string;
    trackingNumber?: string;
    trackingUrl?: string;
    labelUrl: string;
    price: number;
    currency: string;
    status: string;
}

export interface PacklinkTrackingEvent {
    status: string;
    description: string;
    location: string;
    timestamp: number;
    date: string;
}

export interface PacklinkLabelResult {
    shipmentId: string;
    labelUrl: string;
}

const PACKLINK_API_BASE = 'https://api.packlink.com';

function getConfig(): PacklinkConfig {
    const apiKey = process.env.PACKLINK_API_KEY;
    if (!apiKey) {
        throw new Error('PACKLINK_API_KEY environment variable is not set');
    }

    return {
        apiKey,
        senderName: process.env.PACKLINK_SENDER_NAME || 'Fewya',
        senderCompany: process.env.PACKLINK_SENDER_COMPANY || 'Fewya Marketplace',
        senderAddress: process.env.PACKLINK_SENDER_ADDRESS || 'Calle Principal 1',
        senderCity: process.env.PACKLINK_SENDER_CITY || 'Madrid',
        senderPostalCode: process.env.PACKLINK_SENDER_POSTAL_CODE || '28001',
        senderCountry: process.env.PACKLINK_SENDER_COUNTRY || 'ES',
        senderPhone: process.env.PACKLINK_SENDER_PHONE || '+34600000000',
        senderEmail: process.env.PACKLINK_SENDER_EMAIL || 'envios@fewya.com',
    };
}

async function packlinkRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const config = getConfig();
    const url = `${PACKLINK_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Packlink API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response.json() as Promise<T>;
}

export async function getShippingQuotes(
    fromPostalCode: string,
    fromCountry: string,
    toPostalCode: string,
    toCountry: string,
    parcels: PacklinkParcel[]
): Promise<PacklinkShippingQuote[]> {
    const payload = {
        from: {
            postal_code: fromPostalCode,
            country: fromCountry,
        },
        to: {
            postal_code: toPostalCode,
            country: toCountry,
        },
        parcels: parcels.map((p) => ({
            weight: p.weight,
            length: p.length,
            width: p.width,
            height: p.height,
        })),
    };

    const result = await packlinkRequest<{
        services: Array<{
            carrier_id: string;
            carrier_name: string;
            service_name: string;
            price: { amount: number; currency: string };
            estimated_delivery_days?: number;
            delivery_date?: string;
        }>;
    }>('/v1/shipping_services', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    return (result.services || []).map((s) => ({
        carrierId: s.carrier_id,
        carrierName: s.carrier_name,
        serviceName: s.service_name,
        price: s.price.amount,
        currency: s.price.currency,
        estimatedDays: s.estimated_delivery_days,
        deliveryDate: s.delivery_date,
    }));
}

export async function createShipment(data: PacklinkShipmentData): Promise<PacklinkShipmentResult> {
    const payload = {
        shipment: {
            reference: data.orderId,
            sender: {
                name: data.senderName,
                company: data.senderCompany,
                address: data.senderAddress,
                city: data.senderCity,
                postal_code: data.senderPostalCode,
                country: data.senderCountry,
                phone: data.senderPhone,
                email: data.senderEmail,
            },
            recipient: {
                name: data.recipientName,
                address: data.recipientAddress,
                city: data.recipientCity,
                postal_code: data.recipientPostalCode,
                country: data.recipientCountry,
                phone: data.recipientPhone,
                email: data.recipientEmail,
            },
            parcels: data.parcels.map((p) => ({
                weight: p.weight,
                length: p.length,
                width: p.width,
                height: p.height,
            })),
        },
        requested_services: data.requestedService
            ? [{ carrier_id: data.requestedService.carrierId, service_name: data.requestedService.serviceName }]
            : undefined,
    };

    const result = await packlinkRequest<{
        shipment_id: string;
        reference: string;
        tracking_number?: string;
        tracking_url?: string;
        label_url: string;
        price: { amount: number; currency: string };
        status: string;
    }>('/v1/shipments', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    return {
        shipmentId: result.shipment_id,
        reference: result.reference,
        trackingNumber: result.tracking_number,
        trackingUrl: result.tracking_url,
        labelUrl: result.label_url,
        price: result.price.amount,
        currency: result.price.currency,
        status: result.status,
    };
}

export async function getShipmentLabel(shipmentId: string): Promise<string> {
    const result = await packlinkRequest<{ label_url: string }>(
        `/v1/shipments/${shipmentId}/labels`
    );
    return result.label_url;
}

export async function getTrackingHistory(shipmentId: string): Promise<PacklinkTrackingEvent[]> {
    const result = await packlinkRequest<{ events: PacklinkTrackingEvent[] }>(
        `/v1/shipments/${shipmentId}/tracking`
    );
    return result.events || [];
}

export async function getShipment(shipmentId: string): Promise<{
    shipmentId: string;
    reference: string;
    status: string;
    trackingNumber?: string;
    trackingUrl?: string;
    labelUrl?: string;
}> {
    return packlinkRequest(`/v1/shipments/${shipmentId}`);
}

export async function cancelShipment(shipmentId: string): Promise<void> {
    await packlinkRequest(`/v1/shipments/${shipmentId}/cancel`, {
        method: 'POST',
    });
}

export function calculateParcelFromItems(
    items: Array<{
        weightKg?: number | null;
        lengthCm?: number | null;
        widthCm?: number | null;
        heightCm?: number | null;
        quantity: number;
    }>
): PacklinkParcel[] {
    const parcels: PacklinkParcel[] = [];
    const DEFAULT_WEIGHT = 0.5;
    const DEFAULT_DIMENSION = 10;

    for (const item of items) {
        const weight = item.weightKg ?? DEFAULT_WEIGHT;
        const length = item.lengthCm ?? DEFAULT_DIMENSION;
        const width = item.widthCm ?? DEFAULT_DIMENSION;
        const height = item.heightCm ?? DEFAULT_DIMENSION;

        for (let i = 0; i < item.quantity; i++) {
            parcels.push({ weight, length, width, height });
        }
    }

    return parcels;
}

export function parseSpanishAddress(
    address: string
): { street: string; postalCode: string; city: string } {
    const lines = address.split('\n').map((l) => l.trim()).filter(Boolean);
    const fullText = lines.join(', ');

    const postalCodeMatch = fullText.match(/\b\d{5}\b/);
    const postalCode = postalCodeMatch ? postalCodeMatch[0] : '';

    const parts = fullText.split(',').map((p) => p.trim());
    const city = parts[parts.length - 1] || '';
    const street = parts.slice(0, -1).join(', ') || fullText;

    return { street, postalCode, city };
}
