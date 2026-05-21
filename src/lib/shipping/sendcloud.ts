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
    servicePointInput?: string;
    minWeightKg?: number;
    maxWeightKg?: number;
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
    // Sendcloud service point id (pickup point). Required when the shipping
    // option ends in /service_point — without it Sendcloud has no destination point.
    toServicePointId?: string;
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

import { SENDCLOUD_API_KEY, SENDCLOUD_API_SECRET } from 'astro:env/server';

const SENDCLOUD_API_BASE = 'https://panel.sendcloud.sc/api/v2';
const SENDCLOUD_API_V3_BASE = 'https://panel.sendcloud.sc/api/v3';

function envVar(key: string): string | undefined {
    return (import.meta.env as Record<string, string | undefined>)?.[key];
}

export function getConfig(): SendcloudConfig {
    const apiKey = SENDCLOUD_API_KEY;
    const apiSecret = SENDCLOUD_API_SECRET;
    if (!apiKey || !apiSecret) {
        throw new Error('SENDCLOUD_API_KEY and SENDCLOUD_API_SECRET environment variables are required');
    }

    return {
        apiKey,
        apiSecret,
        senderName: envVar('SENDCLOUD_SENDER_NAME') || 'Fewya',
        senderCompany: envVar('SENDCLOUD_SENDER_COMPANY') || 'Fewya Marketplace',
        senderAddress: envVar('SENDCLOUD_SENDER_ADDRESS') || 'Calle Principal 1',
        senderCity: envVar('SENDCLOUD_SENDER_CITY') || 'Madrid',
        senderPostalCode: envVar('SENDCLOUD_SENDER_POSTAL_CODE') || '28001',
        senderCountry: envVar('SENDCLOUD_SENDER_COUNTRY') || 'ES',
        senderPhone: envVar('SENDCLOUD_SENDER_PHONE') || '+34600000000',
        senderEmail: envVar('SENDCLOUD_SENDER_EMAIL') || 'envios@fewya.com',
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

async function sendcloudRequestV3<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${SENDCLOUD_API_V3_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            ...getAuthHeaders(),
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Sendcloud API v3 error: ${response.status} ${response.statusText} - ${errorBody}`);
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
    const body: Record<string, unknown> = {
        from_country_code: fromCountry || 'ES',
        to_country_code: toCountry,
        parcels: parcels.map((p) => ({
            weight: {
                value: String(p.weight),
                unit: 'kg',
            },
            ...(p.length && p.width && p.height
                ? {
                    dimensions: {
                        length: String(p.length),
                        width: String(p.width),
                        height: String(p.height),
                        unit: 'cm',
                    },
                }
                : {}),
        })),
        calculate_quotes: true,
    };

    if (fromPostalCode) {
        body.from_postal_code = fromPostalCode;
    }
    if (toPostalCode) {
        body.to_postal_code = toPostalCode;
    }

    const result = await sendcloudRequestV3<{
        data?: Array<{
            code: string;
            name: string;
            carrier: { code: string; name: string };
            functionalities?: { last_mile?: string };
            weight?: {
                min?: { value: string; unit: string };
                max?: { value: string; unit: string };
            };
            quotes?: Array<{
                lead_time?: number;
                price?: {
                    total?: { value: string; currency: string };
                };
            }>;
        }>;
    }>('/shipping-options', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    const options = result.data ?? [];
    const quotes: SendcloudShippingQuote[] = [];

    for (const opt of options) {
        const quote = opt.quotes?.[0];
        if (!quote?.price?.total) continue;

        const total = quote.price.total;
        const price = parseFloat(total.value);
        if (!Number.isFinite(price)) continue;

        const minW = opt.weight?.min ? parseFloat(opt.weight.min.value) : undefined;
        const maxW = opt.weight?.max ? parseFloat(opt.weight.max.value) : undefined;

        quotes.push({
            carrierId: opt.carrier?.code ?? '',
            carrierName: opt.carrier?.name ?? '',
            serviceName: opt.name,
            shippingOptionCode: opt.code,
            price,
            currency: total.currency,
            leadTimeHours: quote.lead_time,
            servicePointInput: opt.functionalities?.last_mile === 'service_point' ? 'required' : 'none',
            minWeightKg: Number.isFinite(minW) ? minW : undefined,
            maxWeightKg: Number.isFinite(maxW) ? maxW : undefined,
        });
    }

    return quotes;
}

export async function createShipment(data: SendcloudShipmentData): Promise<SendcloudShipmentResult> {
    if (!data.requestedService) {
        throw new Error('Sendcloud createShipment requires a requestedService (shipping_option_code)');
    }

    const payload: Record<string, unknown> = {
        apply_shipping_defaults: false,
        apply_shipping_rules: false,
        order_number: data.orderId,
        from_address: {
            name: data.senderName,
            company_name: data.senderCompany || '',
            address_line_1: data.senderAddress,
            postal_code: data.senderPostalCode,
            city: data.senderCity,
            country_code: data.senderCountry,
            phone_number: data.senderPhone,
            email: data.senderEmail,
        },
        to_address: {
            name: data.recipientName,
            address_line_1: data.recipientAddress,
            postal_code: data.recipientPostalCode,
            city: data.recipientCity,
            country_code: data.recipientCountry,
            phone_number: data.recipientPhone,
            email: data.recipientEmail,
        },
        ship_with: {
            type: 'shipping_option_code',
            properties: {
                shipping_option_code: data.requestedService.shippingOptionCode,
            },
        },
        parcels: data.parcels.map((p) => ({
            weight: { value: p.weight.toFixed(3), unit: 'kg' },
            ...(p.length && p.width && p.height
                ? {
                    dimensions: {
                        length: String(p.length),
                        width: String(p.width),
                        height: String(p.height),
                        unit: 'cm',
                    },
                }
                : {}),
        })),
    };

    if (data.toServicePointId) {
        payload.to_service_point = { id: data.toServicePointId };
    }

    console.log(JSON.stringify(payload));

    const result = await sendcloudRequestV3<{
        data: {
            id: string;
            parcels: Array<{
                id: number;
                tracking_number?: string;
                tracking_url?: string;
                status?: { code?: string; message?: string };
                documents?: Array<{ type?: string; link?: string }>;
                label_file?: string;
            }>;
            errors?: Array<{ status?: string; code?: string; detail?: string }>;
        };
    }>('/shipments/announce-with-shipping-rules', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    const shipment = result.data;
    const parcel = shipment.parcels?.[0];

    if (!parcel) {
        const detail = shipment.errors?.map((e) => e.detail).filter(Boolean).join('; ') || 'no parcel returned';
        throw new Error(`Sendcloud v3 announce returned no parcel: ${detail}`);
    }

    const labelDoc = parcel.documents?.find((d) => d.type === 'label');
    const labelUrl = labelDoc?.link || '';

    return {
        shipmentId: String(parcel.id),
        reference: data.orderId,
        trackingNumber: parcel.tracking_number,
        trackingUrl: parcel.tracking_url,
        labelUrl,
        price: 0, // Price is invoiced separately by Sendcloud
        currency: 'EUR',
        status: parcel.status?.message || parcel.status?.code || 'created',
    };
}

export async function downloadSendcloudLabelPdf(documentUrl: string): Promise<Uint8Array> {
    const response = await fetch(documentUrl, {
        method: 'GET',
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        throw new Error(
            `Sendcloud label download failed: ${response.status} ${response.statusText}`,
        );
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
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

const LABEL_IVA_RATE = 1.21;
const LABEL_QUOTE_DESTINATION = '28001';

/**
 * Returns the most expensive *net* label price the seller would actually
 * absorb for a variant's weight + dimensions: the worst-case across the
 * known carrier buckets after applying IVA and subtracting Fewya's
 * per-carrier shipping subsidy. Returns null if no recognized carrier
 * returned a quote.
 */
export async function getMaxLabelPriceEur(
    weightKg: number,
    lengthCm: number | null | undefined,
    widthCm: number | null | undefined,
    heightCm: number | null | undefined,
): Promise<number | null> {
    const { categorize } = await import('./carrierKey');
    const { getCarrierSubsidy } = await import('../cart/checkout');
    const config = getConfig();

    const length = Number(lengthCm) || 0;
    const width = Number(widthCm) || 0;
    const height = Number(heightCm) || 0;
    const volumetric = length > 0 && width > 0 && height > 0 ? (length * width * height) / 5000 : 0;
    const billable = Math.max(weightKg, volumetric);

    const quotes = await getShippingQuotes(
        config.senderPostalCode,
        'ES',
        LABEL_QUOTE_DESTINATION,
        'ES',
        [{
            weight: billable,
            length: length || undefined,
            width: width || undefined,
            height: height || undefined,
        }],
    );

    const cheapestByBucket: Record<string, number> = {};
    for (const q of quotes) {
        const key = categorize(q.carrierId, q.serviceName, q.servicePointInput);
        if (!key) continue;
        if (cheapestByBucket[key] == null || q.price < cheapestByBucket[key]) {
            cheapestByBucket[key] = q.price;
        }
    }

    const netByBucket = Object.entries(cheapestByBucket).map(([key, base]) => {
        const gross = base * LABEL_IVA_RATE;
        const subsidy = getCarrierSubsidy(key);
        return Math.max(0, gross - subsidy);
    });

    if (netByBucket.length === 0) return null;

    return Math.round(Math.max(...netByBucket) * 100) / 100;
}

// Items are always consolidated into a single parcel so that Sendcloud returns
// service-point (pickup point) rates, which only support single-parcel shipments.
// Heuristic: weight = sum, length/width = max, height = sum (items stacked).
export function calculateParcelFromItems(
    items: Array<{
        weightKg?: number | null;
        lengthCm?: number | null;
        widthCm?: number | null;
        heightCm?: number | null;
        quantity: number;
    }>
): SendcloudParcel[] {
    const DEFAULT_WEIGHT = 0.5;
    const DEFAULT_DIMENSION = 10;

    let totalWeight = 0;
    let maxLength = 0;
    let maxWidth = 0;
    let totalHeight = 0;
    let anyItem = false;

    for (const item of items) {
        const qty = Math.max(0, item.quantity ?? 0);
        if (qty === 0) continue;
        const weight = item.weightKg ?? DEFAULT_WEIGHT;
        const length = item.lengthCm ?? DEFAULT_DIMENSION;
        const width = item.widthCm ?? DEFAULT_DIMENSION;
        const height = item.heightCm ?? DEFAULT_DIMENSION;

        totalWeight += weight * qty;
        totalHeight += height * qty;
        if (length > maxLength) maxLength = length;
        if (width > maxWidth) maxWidth = width;
        anyItem = true;
    }

    if (!anyItem) return [];

    return [{
        weight: Math.round(totalWeight * 1000) / 1000,
        length: Math.round(maxLength * 10) / 10,
        width: Math.round(maxWidth * 10) / 10,
        height: Math.round(totalHeight * 10) / 10,
    }];
}

export interface SendcloudServicePoint {
    id: number;
    name: string;
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
    latitude: string;
    longitude: string;
    carrier: string;
    distance?: number;
    formattedOpeningTimes: Record<string, string[]>;
}

export async function getServicePoints(
    address: string,
    country: string,
    carriers: string[]
): Promise<SendcloudServicePoint[]> {
    const config = getConfig();
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');

    async function doRequest(requestedCarriers: string[]): Promise<SendcloudServicePoint[]> {
        const url = new URL('https://servicepoints.sendcloud.sc/api/v2/service-points');
        url.searchParams.set('country', country);
        url.searchParams.set('address', address);
        url.searchParams.set('radius', '5000');
        for (const carrier of requestedCarriers) {
            url.searchParams.append('carrier', carrier);
        }

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Basic ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Sendcloud Service Points API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const raw = await response.json();
        // Sendcloud returns an array directly, but some versions may wrap it in service_points
        const servicePoints = Array.isArray(raw)
            ? raw
            : (raw as { service_points?: unknown[] })?.service_points || [];

        return servicePoints.map((sp: any) => ({
            id: sp.id,
            name: sp.name,
            street: sp.street,
            houseNumber: sp.house_number,
            postalCode: sp.postal_code,
            city: sp.city,
            latitude: sp.latitude,
            longitude: sp.longitude,
            carrier: sp.carrier,
            distance: sp.distance,
            formattedOpeningTimes: sp.formatted_opening_times,
        }));
    }

    try {
        return await doRequest(carriers);
    } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        // If some carriers aren't activated, retry without carrier filter to show all available ones
        if (msg.includes('haven\'t been activated')) {
            return await doRequest([]);
        }
        throw err;
    }
}

export function parseSpanishAddress(
    address: string
): { street: string; postalCode: string; city: string } {
    const lines = address.split('\n').map((l) => l.trim()).filter(Boolean);
    const fullText = lines.join(', ');

    const postalCodeMatch = fullText.match(/\b\d{5}\b/);
    const postalCode = postalCodeMatch ? postalCodeMatch[0] : '';

    const parts = fullText.split(',').map((p) => p.trim());
    const rawCity = parts[parts.length - 1] || '';
    // Strip the postal code from the city portion ("29720 LA CALA DEL MORAL" → "LA CALA DEL MORAL")
    const city = (postalCode ? rawCity.replace(postalCode, '') : rawCity)
        .replace(/\s+/g, ' ')
        .trim();
    const rawStreet = parts.slice(0, -1).join(', ') || fullText;
    // Also strip postal code from street if it leaked there
    const street = (postalCode ? rawStreet.replace(postalCode, '') : rawStreet)
        .replace(/\s+/g, ' ')
        .replace(/[,\s]+$/, '')
        .trim();

    return { street, postalCode, city };
}
