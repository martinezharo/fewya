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
    toServicePointId?: string;
}

export interface SendcloudAnnounceResponse {
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

/** A carrier rejected an otherwise successful Sendcloud API request. */
export class SendcloudAnnouncementError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SendcloudAnnouncementError';
    }
}

/** Builds the v3 announce payload without credentials or network side effects. */
export function buildSendcloudShipmentPayload(data: SendcloudShipmentData): Record<string, unknown> {
    if (!data.requestedService) {
        throw new Error('Sendcloud createShipment requires a requestedService (shipping_option_code)');
    }
    const shippingOptionCode = data.requestedService.shippingOptionCode;
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
            properties: { shipping_option_code: shippingOptionCode },
        },
        parcels: data.parcels.map((parcel) => ({
            weight: { value: parcel.weight.toFixed(3), unit: 'kg' },
            // InPost derives volumetric weight itself and rejects dimensions
            // whose calculated precision does not fit its contract.
            ...(!shippingOptionCode.startsWith('inpost_es:')
                && parcel.length && parcel.width && parcel.height
                ? {
                    dimensions: {
                        length: String(parcel.length),
                        width: String(parcel.width),
                        height: String(parcel.height),
                        unit: 'cm',
                    },
                }
                : {}),
        })),
    };

    if (data.toServicePointId) payload.to_service_point = { id: data.toServicePointId };
    return payload;
}

/** Turns Sendcloud's HTTP-success body into an accepted shipment or a rejection. */
export function parseSendcloudShipmentResponse(
    result: SendcloudAnnounceResponse,
    orderId: string,
): SendcloudShipmentResult {
    const shipment = result.data;
    const parcel = shipment.parcels?.[0];
    if (!parcel) {
        const detail = shipment.errors?.map((error) => error.detail).filter(Boolean).join('; ') || 'no parcel returned';
        throw new SendcloudAnnouncementError(`Sendcloud v3 announce returned no parcel: ${detail}`);
    }

    const errors = shipment.errors?.map((error) => error.detail).filter((detail): detail is string => Boolean(detail)) ?? [];
    const statusCode = parcel.status?.code?.trim().toUpperCase() ?? '';
    if (statusCode.includes('FAILED') || errors.length > 0) {
        const detail = errors.join('; ') || parcel.status?.message || statusCode || 'Carrier announcement failed';
        throw new SendcloudAnnouncementError(detail);
    }

    const labelUrl = parcel.documents?.find((document) => document.type === 'label')?.link || '';
    if (!labelUrl) throw new SendcloudAnnouncementError('Sendcloud did not return a shipping label');

    return {
        shipmentId: String(parcel.id),
        reference: orderId,
        trackingNumber: parcel.tracking_number,
        trackingUrl: parcel.tracking_url,
        labelUrl,
        price: 0,
        currency: 'EUR',
        status: parcel.status?.message || parcel.status?.code || 'created',
    };
}
