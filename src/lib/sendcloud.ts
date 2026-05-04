export const DEFAULT_SHOP_SHIPPING_EUR = 3.49;

export interface SendcloudConfig {
    apiKey: string;
    apiSecret: string;
    senderName: string;
    senderCompany?: string;
    senderAddress: string;
    senderCity: string;
    senderPostalCode: string;
    senderCountry: string;
    senderPhone: string;
    senderEmail: string;
}

export interface SendcloudShippingQuote {
    carrierId: string;
    carrierName: string;
    serviceName: string;
    shippingOptionCode: string;
    price: number;
    currency: string;
    estimatedDays?: number;
    leadTimeHours?: number;
}

export interface SendcloudParcel {
    weight: number;
    length?: number;
    width?: number;
    height?: number;
}

export interface SendcloudShipmentData {
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
    parcels: SendcloudParcel[];
    requestedService?: {
        shippingOptionCode: string;
    };
}

export interface SendcloudShipmentResult {
    shipmentId: string;
    reference: string;
    trackingNumber?: string;
    trackingUrl?: string;
    labelUrl: string;
    price: number;
    currency: string;
    status: string;
}

export interface SendcloudTrackingEvent {
    status: string;
    description: string;
    location: string;
    timestamp: number;
    date: string;
}

export interface SendcloudLabelResult {
    shipmentId: string;
    labelUrl: string;
}

const SENDCLOUD_API_BASE = 'https://panel.sendcloud.sc/api/v2';

function getConfig(): SendcloudConfig {
    const apiKey = process.env.SENDCLOUD_API_KEY;
    const apiSecret = process.env.SENDCLOUD_API_SECRET;
    if (!apiKey || !apiSecret) {
        throw new Error('SENDCLOUD_API_KEY and SENDCLOUD_API_SECRET environment variables are required');
    }

    return {
        apiKey,
        apiSecret,
        senderName: process.env.SENDCLOUD_SENDER_NAME || 'Fewya',
        senderCompany: process.env.SENDCLOUD_SENDER_COMPANY || 'Fewya Marketplace',
        senderAddress: process.env.SENDCLOUD_SENDER_ADDRESS || 'Calle Principal 1',
        senderCity: process.env.SENDCLOUD_SENDER_CITY || 'Madrid',
        senderPostalCode: process.env.SENDCLOUD_SENDER_POSTAL_CODE || '28001',
        senderCountry: process.env.SENDCLOUD_SENDER_COUNTRY || 'ES',
        senderPhone: process.env.SENDCLOUD_SENDER_PHONE || '+34600000000',
        senderEmail: process.env.SENDCLOUD_SENDER_EMAIL || 'envios@fewya.com',
    };
}

function getAuthHeaders(): Record<string, string> {
    const config = getConfig();
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    return {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json',
    };
}

async function sendcloudRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${SENDCLOUD_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            ...getAuthHeaders(),
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Sendcloud API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response.json() as Promise<T>;
}

export async function getShippingQuotes(
    fromPostalCode: string,
    fromCountry: string,
    toPostalCode: string,
    toCountry: string,
    parcels: SendcloudParcel[]
): Promise<SendcloudShippingQuote[]> {
    const totalWeight = parcels.reduce((sum, p) => sum + p.weight, 0);

    const payload = {
        from_country: fromCountry,
        to_country: toCountry,
        weight: totalWeight,
        weight_unit: 'kilogram',
        calculate_quotes: true,
    };

    const result = await sendcloudRequest<{
        shipping_options: Array<{
            code: string;
            name: string;
            carrier: {
                code: string;
                name: string;
            };
            quotes?: Array<{
                price: {
                    total: number;
                    currency: string;
                };
                lead_time?: {
                    hours?: number;
                };
            }>;
        }>;
    }>('/shipping-options', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    const quotes: SendcloudShippingQuote[] = [];

    for (const opt of result.shipping_options || []) {
        const quote = opt.quotes?.[0];
        if (!quote) continue;

        quotes.push({
            carrierId: opt.carrier.code,
            carrierName: opt.carrier.name,
            serviceName: opt.name,
            shippingOptionCode: opt.code,
            price: quote.price.total,
            currency: quote.price.currency,
            leadTimeHours: quote.lead_time?.hours,
        });
    }

    return quotes;
}

export async function createShipment(data: SendcloudShipmentData): Promise<SendcloudShipmentResult> {
    const payload = {
        name: data.recipientName,
        company_name: '',
        address: data.recipientAddress,
        address_2: '',
        house_number: '',
        city: data.recipientCity,
        postal_code: data.recipientPostalCode,
        country: data.recipientCountry,
        telephone: data.recipientPhone,
        email: data.recipientEmail,
        request_label: true,
        sender_address: {
            name: data.senderName,
            company_name: data.senderCompany || '',
            address: data.senderAddress,
            city: data.senderCity,
            postal_code: data.senderPostalCode,
            country: data.senderCountry,
            telephone: data.senderPhone,
            email: data.senderEmail,
        },
        parcels: data.parcels.map((p, index) => ({
            name: `${data.recipientName} - Parcel ${index + 1}`,
            weight: p.weight.toFixed(3),
            weight_unit: 'kilogram',
            length: p.length ? String(p.length) : undefined,
            width: p.width ? String(p.width) : undefined,
            height: p.height ? String(p.height) : undefined,
        })),
        shipment: data.requestedService
            ? {
                shipping_option_code: data.requestedService.shippingOptionCode,
            }
            : undefined,
        order_number: data.orderId,
    };

    const result = await sendcloudRequest<{
        parcel: {
            id: number;
            tracking_number?: string;
            tracking_url?: string;
            status?: {
                message?: string;
            };
        };
        label?: {
            normal_printer?: string;
            label_printer?: string;
        };
    }>('/parcels', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    const parcel = result.parcel;
    const labelUrl = result.label?.normal_printer || result.label?.label_printer || '';

    return {
        shipmentId: String(parcel.id),
        reference: data.orderId,
        trackingNumber: parcel.tracking_number,
        trackingUrl: parcel.tracking_url,
        labelUrl,
        price: 0, // Price is invoiced separately by Sendcloud
        currency: 'EUR',
        status: parcel.status?.message || 'created',
    };
}

export async function getShipmentLabel(parcelId: string): Promise<string> {
    const result = await sendcloudRequest<{
        label?: {
            normal_printer?: string;
            label_printer?: string;
        };
    }>(`/parcels/${parcelId}/documents/label`);

    return result.label?.normal_printer || result.label?.label_printer || '';
}

export async function getTrackingHistory(parcelId: string): Promise<SendcloudTrackingEvent[]> {
    const result = await sendcloudRequest<{
        parcel: {
            status?: {
                message?: string;
                changed?: string;
            };
            tracking_history?: Array<{
                status?: string;
                message?: string;
                location?: string;
                created_at?: string;
            }>;
        };
    }>(`/parcels/${parcelId}`);

    const history = result.parcel.tracking_history || [];
    return history.map((h) => ({
        status: h.status || 'unknown',
        description: h.message || '',
        location: h.location || '',
        timestamp: h.created_at ? new Date(h.created_at).getTime() / 1000 : 0,
        date: h.created_at || '',
    }));
}

export async function getShipment(parcelId: string): Promise<{
    shipmentId: string;
    reference: string;
    status: string;
    trackingNumber?: string;
    trackingUrl?: string;
    labelUrl?: string;
}> {
    const result = await sendcloudRequest<{
        parcel: {
            id: number;
            tracking_number?: string;
            tracking_url?: string;
            status?: { message?: string };
            order_number?: string;
        };
    }>(`/parcels/${parcelId}`);

    return {
        shipmentId: String(result.parcel.id),
        reference: result.parcel.order_number || '',
        status: result.parcel.status?.message || 'unknown',
        trackingNumber: result.parcel.tracking_number,
        trackingUrl: result.parcel.tracking_url,
    };
}

export async function cancelShipment(parcelId: string): Promise<void> {
    await sendcloudRequest(`/parcels/${parcelId}/cancel`, {
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
): SendcloudParcel[] {
    const parcels: SendcloudParcel[] = [];
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
