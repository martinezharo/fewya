import { SENDCLOUD_API_KEY, SENDCLOUD_API_SECRET } from 'astro:env/server';
import type {
    SendcloudAnnounceResponse,
    SendcloudParcel,
    SendcloudShipmentData,
    SendcloudShipmentResult,
} from './sendcloudContract';
import { buildSendcloudShipmentPayload, parseSendcloudShipmentResponse } from './sendcloudContract';
import {
    platformForServicePointCarrier,
    servicePointCarriersForPlatforms,
    type ShippingPlatform,
} from './shippingPlatform';

export { SendcloudAnnouncementError } from './sendcloudContract';
export type { SendcloudParcel, SendcloudShipmentData, SendcloudShipmentResult } from './sendcloudContract';

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
// Search radius around the buyer's address, in metres.
const SERVICE_POINT_RADIUS_METERS = 5000;

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
        senderEmail: envVar('SENDCLOUD_SENDER_EMAIL') || 'hola@fewya.com',
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
    const payload = buildSendcloudShipmentPayload(data);
    const result = await sendcloudRequestV3<SendcloudAnnounceResponse>('/shipments/announce-with-shipping-rules', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return parseSendcloudShipmentResponse(result, data.orderId);
}

/** Hosts that may be sent the Sendcloud API credentials. */
const SENDCLOUD_HOSTS = ['sendcloud.sc', 'sendcloud.com'];

function isSendcloudUrl(value: string): boolean {
    try {
        const { protocol, hostname } = new URL(value);
        if (protocol !== 'https:') return false;
        return SENDCLOUD_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

export async function downloadSendcloudLabelPdf(documentUrl: string): Promise<Uint8Array> {
    // This request carries the Sendcloud API key and secret. The URL comes
    // from a stored shipment row, so refuse to send those credentials
    // anywhere but Sendcloud itself.
    if (!isSendcloudUrl(documentUrl)) {
        throw new Error('Refusing to fetch a label from a non-Sendcloud URL');
    }

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
    platforms: ShippingPlatform[]
): Promise<SendcloudServicePoint[]> {
    const config = getConfig();
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');

    async function doRequest(requestedCarriers: string[]): Promise<SendcloudServicePoint[]> {
        const url = new URL('https://servicepoints.sendcloud.sc/api/v2/service-points/');
        url.searchParams.set('country', country);
        url.searchParams.set('address', address);
        url.searchParams.set('radius', String(SERVICE_POINT_RADIUS_METERS));
        // Sendcloud expects ONE comma-separated `carrier` param. Repeating the
        // param silently keeps only the last value, which would drop every
        // other carrier's points from the results.
        if (requestedCarriers.length > 0) {
            url.searchParams.set('carrier', requestedCarriers.join(','));
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

    // Keep only points whose carrier maps to one of the requested platforms.
    // Sendcloud's own carrier filter can be bypassed (see the fallback below),
    // and we never want to surface a carrier the seller hasn't enabled — those
    // would otherwise be rejected later at checkout. An empty `platforms` list
    // means "no restriction".
    function filterByPlatform(points: SendcloudServicePoint[]): SendcloudServicePoint[] {
        if (platforms.length === 0) return points;
        return points.filter((sp) => {
            const platform = platformForServicePointCarrier(sp.carrier);
            return platform !== null && platforms.includes(platform);
        });
    }

    const carriers = servicePointCarriersForPlatforms(platforms);

    try {
        return filterByPlatform(await doRequest(carriers));
    } catch (err) {
        // Sendcloud rejects the WHOLE request when any requested carrier is not
        // usable for service points on this account (not activated, or without
        // service point delivery at all). Retry unfiltered and drop the
        // disallowed carriers ourselves, so one bad carrier never costs the
        // buyer every pickup point.
        if (isCarrierRejection(err)) {
            return filterByPlatform(await doRequest([]));
        }
        throw err;
    }
}

// Sendcloud has no error code for this: the carrier filter being unusable is
// only distinguishable by the message it returns with its 400 / 401.
const CARRIER_REJECTION_HINTS = [
    "haven't been activated",
    'have not been activated',
    'do not support service point delivery',
    'does not support service point delivery',
];

function isCarrierRejection(err: unknown): boolean {
    const message = (err instanceof Error ? err.message : '').toLowerCase();
    return CARRIER_REJECTION_HINTS.some((hint) => message.includes(hint));
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
