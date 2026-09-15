import {
    buildSendcloudShipmentPayload,
    parseSendcloudShipmentResponse,
    type SendcloudAnnounceResponse,
    type SendcloudShipmentData,
} from '../src/lib/shipping/sendcloudContract';
import { isPlaceholderEmail } from '../convex/lib/placeholderEmail';

const CONFIRMATION = 'I_ACCEPT_A_REAL_LABEL_CHARGE';
const V3_BASE = 'https://panel.sendcloud.sc/api/v3';
const V2_BASE = 'https://panel.sendcloud.sc/api/v2';

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function authHeaders(apiKey: string, apiSecret: string): Record<string, string> {
    return {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
    };
}

async function responseJson<T>(response: Response): Promise<T> {
    const body = await response.text();
    if (!response.ok) throw new Error(`Sendcloud API error ${response.status}: ${body}`);
    return JSON.parse(body) as T;
}

if (process.env.SENDCLOUD_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to create a real label. Set SENDCLOUD_SMOKE_CONFIRM=${CONFIRMATION}`);
}

const apiKey = required('SENDCLOUD_API_KEY');
const apiSecret = required('SENDCLOUD_API_SECRET');
const expectedCostEur = Number(required('SENDCLOUD_SMOKE_EXPECTED_COST_EUR'));
if (!Number.isFinite(expectedCostEur) || expectedCostEur < 0) {
    throw new Error('SENDCLOUD_SMOKE_EXPECTED_COST_EUR must be a non-negative number');
}

const data: SendcloudShipmentData = {
    orderId: `FEWYA-SMOKE-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
    senderName: required('SENDCLOUD_SMOKE_SENDER_NAME'),
    senderCompany: process.env.SENDCLOUD_SMOKE_SENDER_COMPANY?.trim(),
    senderAddress: required('SENDCLOUD_SMOKE_SENDER_ADDRESS'),
    senderCity: required('SENDCLOUD_SMOKE_SENDER_CITY'),
    senderPostalCode: required('SENDCLOUD_SMOKE_SENDER_POSTAL_CODE'),
    senderCountry: process.env.SENDCLOUD_SMOKE_SENDER_COUNTRY?.trim() || 'ES',
    senderPhone: required('SENDCLOUD_SMOKE_SENDER_PHONE'),
    senderEmail: required('SENDCLOUD_SMOKE_SENDER_EMAIL'),
    recipientName: required('SENDCLOUD_SMOKE_RECIPIENT_NAME'),
    recipientAddress: required('SENDCLOUD_SMOKE_RECIPIENT_ADDRESS'),
    recipientCity: required('SENDCLOUD_SMOKE_RECIPIENT_CITY'),
    recipientPostalCode: required('SENDCLOUD_SMOKE_RECIPIENT_POSTAL_CODE'),
    recipientCountry: process.env.SENDCLOUD_SMOKE_RECIPIENT_COUNTRY?.trim() || 'ES',
    recipientPhone: required('SENDCLOUD_SMOKE_RECIPIENT_PHONE'),
    recipientEmail: required('SENDCLOUD_SMOKE_RECIPIENT_EMAIL'),
    parcels: [{ weight: Number(process.env.SENDCLOUD_SMOKE_WEIGHT_KG || '0.5') }],
    requestedService: { shippingOptionCode: required('SENDCLOUD_SMOKE_SHIPPING_OPTION_CODE') },
    toServicePointId: process.env.SENDCLOUD_SMOKE_SERVICE_POINT_ID?.trim() || undefined,
};

if (isPlaceholderEmail(data.senderEmail) || isPlaceholderEmail(data.recipientEmail)) {
    throw new Error('Smoke-test email addresses must not use the placeholder domain');
}
if (!Number.isFinite(data.parcels[0].weight) || data.parcels[0].weight <= 0) {
    throw new Error('SENDCLOUD_SMOKE_WEIGHT_KG must be a positive number');
}

const headers = authHeaders(apiKey, apiSecret);
let parcelId: string | null = null;
let cancellationError: unknown;

try {
    const announceResponse = await fetch(`${V3_BASE}/shipments/announce-with-shipping-rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildSendcloudShipmentPayload(data)),
    });
    const raw = await responseJson<SendcloudAnnounceResponse>(announceResponse);
    parcelId = raw.data.parcels?.[0]?.id == null ? null : String(raw.data.parcels[0].id);
    const shipment = parseSendcloudShipmentResponse(raw, data.orderId);
    parcelId = shipment.shipmentId;

    const labelResponse = await fetch(shipment.labelUrl, { headers });
    if (!labelResponse.ok) throw new Error(`Label download failed with HTTP ${labelResponse.status}`);
    const contentType = labelResponse.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await labelResponse.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.subarray(0, 4));
    if (!contentType.toLowerCase().includes('pdf') || magic !== '%PDF') {
        throw new Error(`Label is not a PDF (content-type=${contentType}, magic=${JSON.stringify(magic)})`);
    }

    console.log(JSON.stringify({
        event: 'sendcloud_smoke.label_verified',
        orderReference: data.orderId,
        parcelId,
        expectedCostEur,
        contentType,
        bytes: bytes.byteLength,
    }));
} finally {
    if (parcelId) {
        try {
            const cancelResponse = await fetch(`${V2_BASE}/parcels/${encodeURIComponent(parcelId)}/cancel`, {
                method: 'POST',
                headers,
            });
            const cancellation = await responseJson<Record<string, unknown>>(cancelResponse);
            console.log(JSON.stringify({ event: 'sendcloud_smoke.cancelled', parcelId, cancellation }));
        } catch (error) {
            cancellationError = error;
            console.error(JSON.stringify({
                event: 'sendcloud_smoke.cancellation_failed',
                parcelId,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }
}

if (cancellationError) throw cancellationError;
