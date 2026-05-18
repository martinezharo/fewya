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
const SENDCLOUD_API_V3_BASE = 'https://panel.sendcloud.sc/api/v3';

function env(key: string): string | undefined {
    // Astro/Vite exposes .env vars via import.meta.env; fallback to process.env for Node/CF compat
    return (import.meta.env as Record<string, string | undefined>)?.[key] ?? process.env?.[key];
}

export function getConfig(): SendcloudConfig {
    const apiKey = env('SENDCLOUD_API_KEY');
    const apiSecret = env('SENDCLOUD_API_SECRET');
    if (!apiKey || !apiSecret) {
        throw new Error('SENDCLOUD_API_KEY and SENDCLOUD_API_SECRET environment variables are required');
    }

    return {
        apiKey,
        apiSecret,
        senderName: env('SENDCLOUD_SENDER_NAME') || 'Fewya',
        senderCompany: env('SENDCLOUD_SENDER_COMPANY') || 'Fewya Marketplace',
        senderAddress: env('SENDCLOUD_SENDER_ADDRESS') || 'Calle Principal 1',
        senderCity: env('SENDCLOUD_SENDER_CITY') || 'Madrid',
        senderPostalCode: env('SENDCLOUD_SENDER_POSTAL_CODE') || '28001',
        senderCountry: env('SENDCLOUD_SENDER_COUNTRY') || 'ES',
        senderPhone: env('SENDCLOUD_SENDER_PHONE') || '+34600000000',
        senderEmail: env('SENDCLOUD_SENDER_EMAIL') || 'envios@fewya.com',
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
    const city = parts[parts.length - 1] || '';
    const street = parts.slice(0, -1).join(', ') || fullText;

    return { street, postalCode, city };
}
