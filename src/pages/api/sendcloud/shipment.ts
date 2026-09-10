import type { APIRoute } from 'astro';
import { CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { api } from '../../../../convex/_generated/api';
import {
    createShipment,
    parseSpanishAddress,
    calculateParcelFromItems,
    downloadSendcloudLabelPdf,
} from '../../../lib/shipping/sendcloud';
import { uploadLabelPdf } from '../../../lib/shipping/labelStorage';
import { isDevelopment } from '../../../lib/core/env';
import type { createConvexClient } from '../../../lib/core/convex';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { runMockShipment, type ConvexShipmentContext } from '../../../lib/shipping/mockShipment';
import { DELIVERY_TYPE } from '../../../lib/orders/orderStatus';
import { notify } from '../../../lib/notifications/dispatch';
import { NOTIFICATION_TYPE } from '../../../lib/notifications/types';

/** Fire-and-await the buyer "ready to send" notice; never let it fail the request. */
async function notifyBuyerReadyToSend(orderId: string, trackingUrl: string | null | undefined, convexSecret: string) {
    try {
        await notify({
            type: NOTIFICATION_TYPE.BUYER_READY_TO_SEND,
            orderId,
            recipient: 'buyer',
            dataOverride: trackingUrl ? { trackingUrl } : undefined,
            convexSecret,
        });
    } catch (e) {
        console.error(JSON.stringify({ event: 'shipment.notify_failed', orderId, error: e instanceof Error ? e.message : String(e) }));
    }
}

type ConvexShipmentResult =
    | { success: true; shipmentId: string; reference?: string; trackingNumber?: string | null; trackingUrl?: string | null; labelUrl?: string | null; carrierName?: string | null }
    | { success: false; status: number; error: string };

async function createSendcloudShipment({
    context,
    convex,
    shippingOptionCode,
    labelCost,
    request,
}: {
    context: ConvexShipmentContext;
    convex: NonNullable<ReturnType<typeof createConvexClient>>;
    shippingOptionCode: string;
    labelCost: number;
    request: Request;
}): Promise<ConvexShipmentResult> {
    const owner = context.owner;
    const shop = context.shop;
    const senderStreet = [owner.addressStreet, owner.addressNumber, owner.addressFloor]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(' ');
    const senderName = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || shop.name;
    const senderCity = owner.addressCity ?? '';
    const senderPostalCode = owner.addressPostalCode ?? '';
    const senderCountry = owner.addressCountry || 'ES';
    const senderPhone = owner.phone
        ? `${owner.phonePrefix ?? '+34'}${owner.phone}`.replace(/\s+/g, '')
        : '';
    const senderEmail = owner.email || shop.contactEmail || '';
    if (!senderStreet || !senderCity || !senderPostalCode || !senderName || !senderPhone) {
        return { success: false, status: 400, error: 'Completa los datos del vendedor antes de generar etiquetas' };
    }

    const isPickup = context.deliveryType === DELIVERY_TYPE.PICKUP_POINT;
    let recipientStreet = context.shippingAddress || '';
    let recipientCity = '';
    let recipientPostalCode = '';
    if (isPickup && context.pickupPointAddress) {
        const parsed = parseSpanishAddress(context.pickupPointAddress);
        recipientStreet = parsed.street || context.pickupPointAddress;
        recipientCity = parsed.city || context.pickupPointCity || '';
        recipientPostalCode = parsed.postalCode || context.pickupPointPostalCode || '';
    } else {
        const parsed = parseSpanishAddress(context.shippingAddress || '');
        recipientStreet = parsed.street || context.shippingAddress || '';
        recipientCity = parsed.city || '';
        recipientPostalCode = parsed.postalCode || '';
    }

    const parcels = calculateParcelFromItems(context.items.map((item) => ({
        weightKg: item.weightKg ?? undefined,
        lengthCm: item.lengthCm ?? undefined,
        widthCm: item.widthCm ?? undefined,
        heightCm: item.heightCm ?? undefined,
        quantity: item.quantity,
    })));

    try {
        const result = await createShipment({
            orderId: context.publicId,
            senderName,
            senderCompany: shop.name,
            senderAddress: senderStreet,
            senderCity,
            senderPostalCode,
            senderCountry,
            senderPhone,
            senderEmail,
            recipientName: context.shippingFullName || 'Cliente',
            recipientAddress: recipientStreet,
            recipientCity,
            recipientPostalCode,
            recipientCountry: 'ES',
            recipientPhone: context.shippingPhone || '',
            recipientEmail: context.buyerEmail || '',
            parcels,
            requestedService: { shippingOptionCode },
            toServicePointId: isPickup ? (context.pickupPointId || undefined) : undefined,
        });

        let storedLabelUrl = result.labelUrl;
        if (result.labelUrl) {
            try {
                const pdfBytes = await downloadSendcloudLabelPdf(result.labelUrl);
                storedLabelUrl = (await uploadLabelPdf(pdfBytes, request)).marker;
            } catch (error) {
                console.warn('Sendcloud label download/upload failed; retaining provider URL:', error);
            }
        }

        const persisted = await convex.mutation(api.orders.createShipmentForSeller, {
            orderId: context.orderId,
            sendcloudShipmentId: result.shipmentId,
            sendcloudReference: result.reference,
            carrierId: shippingOptionCode,
            carrierName: shippingOptionCode,
            serviceName: shippingOptionCode,
            priceCents: Math.round((labelCost || result.price) * 100),
            currency: result.currency || 'EUR',
            ...(result.trackingNumber ? { trackingNumber: result.trackingNumber } : {}),
            ...(result.trackingUrl ? { trackingUrl: result.trackingUrl } : {}),
            ...(storedLabelUrl ? { labelUrl: storedLabelUrl } : {}),
        });

        return {
            success: true,
            shipmentId: result.shipmentId,
            reference: result.reference,
            trackingNumber: persisted.trackingNumber,
            trackingUrl: persisted.trackingUrl,
            labelUrl: persisted.labelUrl,
            carrierName: persisted.carrierName,
        };
    } catch (error) {
        console.error('Sendcloud create shipment error:', error);
        return { success: false, status: 500, error: 'Failed to create shipment' };
    }
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, locals }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);
    if (!convex) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!CONVEX_WEBHOOK_SECRET) return jsonResponse({ error: 'Convex is not configured' }, 503);

    let body: {
        orderId: string;
        shippingOptionCode?: string;
        labelCost?: number;
    };

    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const { orderId, shippingOptionCode } = body;

    if (!orderId) {
        return jsonResponse({ error: 'orderId is required' }, 400);
    }

    const labelCost = Number.isFinite(body.labelCost) && (body.labelCost as number) >= 0
        ? Math.round((body.labelCost as number) * 100) / 100
        : 0;

    // Seller ownership of the order is enforced by Convex.
    let context: ConvexShipmentContext;
    try {
        context = await convex.query(api.orders.getShipmentContext, { orderId });
    } catch (error) {
        console.error('Convex shipment order lookup failed:', error);
        return jsonResponse({ error: 'Order not found or seller access denied' }, 404);
    }

    // In development we never hit Sendcloud — we generate a mock PDF label
    // locally so sellers can exercise the full flow without real charges.
    if (isDevelopment) {
        const result = await runMockShipment({
            context,
            labelCost,
            t,
            request,
            persist: async (input) => {
                await convex.mutation(api.orders.createShipmentForSeller, input);
            },
        });
        if (!result.success) return jsonResponse({ error: result.error }, result.status);
        await notifyBuyerReadyToSend(orderId, result.trackingUrl, CONVEX_WEBHOOK_SECRET);
        return jsonResponse({
            success: true,
            shipmentId: result.shipmentId,
            trackingNumber: result.trackingNumber,
            trackingUrl: result.trackingUrl,
            labelUrl: result.labelUrl,
            carrierName: result.carrierName,
        }, 200);
    }

    if (!shippingOptionCode) return jsonResponse({ error: 'shippingOptionCode is required' }, 400);
    const result = await createSendcloudShipment({ context, convex, shippingOptionCode, labelCost, request });
    if (!result.success) return jsonResponse({ error: result.error }, result.status);
    await notifyBuyerReadyToSend(orderId, result.trackingUrl, CONVEX_WEBHOOK_SECRET);
    return jsonResponse(result, 200);
};
