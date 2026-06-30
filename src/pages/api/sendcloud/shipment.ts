import type { APIRoute } from 'astro';
import {
    createShipment,
    parseSpanishAddress,
    calculateParcelFromItems,
    downloadSendcloudLabelPdf,
} from '../../../lib/shipping/sendcloud';
import { uploadLabelPdf } from '../../../lib/shipping/labelStorage';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { isDevelopment } from '../../../lib/core/env';
import { runMockShipment } from '../../../lib/shipping/mockShipment';
import { DELIVERY_TYPE } from '../../../lib/orders/orderStatus';
import { notify } from '../../../lib/notifications/dispatch';
import { NOTIFICATION_TYPE } from '../../../lib/notifications/types';

/** Fire-and-await the buyer "ready to send" notice; never let it fail the request. */
async function notifyBuyerReadyToSend(orderId: string, trackingUrl?: string | null) {
    try {
        await notify({
            type: NOTIFICATION_TYPE.BUYER_READY_TO_SEND,
            orderId,
            recipient: 'buyer',
            dataOverride: trackingUrl ? { trackingUrl } : undefined,
        });
    } catch (e) {
        console.error(JSON.stringify({ event: 'shipment.notify_failed', orderId, error: e instanceof Error ? e.message : String(e) }));
    }
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
    const { t } = locals;
    const { createSupabaseAuthClient } = await import('../../../lib/core/auth');
    const authClient = createSupabaseAuthClient(cookies, request);

    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

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

    // In development we never hit Sendcloud — we generate a mock PDF label locally
    // so sellers can exercise the full flow without real shipping charges.
    if (isDevelopment) {
        const result = await runMockShipment({
            userId: user.id,
            authClient,
            orderId,
            labelCost,
            t,
        });
        if (!result.success) {
            return jsonResponse({ error: result.error }, result.status);
        }
        await notifyBuyerReadyToSend(orderId, result.trackingUrl);
        return jsonResponse({
            success: true,
            shipmentId: result.shipmentId,
            trackingNumber: result.trackingNumber,
            trackingUrl: result.trackingUrl,
            labelUrl: result.labelUrl,
            carrierName: result.carrierName,
        }, 200);
    }

    // Production: real Sendcloud call requires a chosen shipping option.
    if (!shippingOptionCode) {
        return jsonResponse({ error: 'shippingOptionCode is required' }, 400);
    }

    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select(`
            id,
            public_id,
            buyer_email,
            delivery_type,
            shipping_full_name,
            shipping_phone,
            shipping_address,
            pickup_point_id,
            pickup_point_address,
            pickup_point_postal_code,
            pickup_point_city,
            shops!inner (
                name,
                contact_email,
                owner:profiles!inner (
                    first_name,
                    last_name,
                    phone,
                    phone_prefix,
                    email,
                    address_street,
                    address_number,
                    address_floor,
                    address_postal_code,
                    address_city,
                    address_country
                )
            ),
            order_items (
                quantity,
                product_variants (
                    weight_kg,
                    length_cm,
                    width_cm,
                    height_cm
                )
            )
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: 'Order not found' }, 404);
    }

    const { data: sellerHasAccess } = await authClient.rpc('order_belongs_to_seller', { p_order_id: orderId });
    if (!sellerHasAccess) {
        return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const shop = Array.isArray(order.shops) ? order.shops[0] : order.shops;
    const owner = shop && (Array.isArray(shop.owner) ? shop.owner[0] : shop.owner);
    if (!shop || !owner) {
        return jsonResponse({ error: 'Seller profile not found' }, 500);
    }

    const senderStreet = [owner.address_street, owner.address_number, owner.address_floor]
        .filter((p: string | null | undefined) => p && p.trim().length > 0)
        .join(' ');
    const senderName = `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || shop.name;
    const senderCompany = shop.name;
    const senderCityName = owner.address_city ?? '';
    const senderPostalCode = owner.address_postal_code ?? '';
    const senderCountry = owner.address_country || 'ES';
    const senderPhone = owner.phone
        ? `${owner.phone_prefix ?? '+34'}${owner.phone}`.replace(/\s+/g, '')
        : '';
    const senderEmail = owner.email ?? shop.contact_email ?? '';

    if (!senderStreet || !senderCityName || !senderPostalCode || !senderName || !senderPhone) {
        return jsonResponse(
            { error: 'Completa los datos del vendedor antes de generar etiquetas' },
            400,
        );
    }

    const isPickup = order.delivery_type === DELIVERY_TYPE.PICKUP_POINT;
    let recipientStreet: string;
    let recipientCityName: string;
    let recipientPostalCode: string;

    if (isPickup && order.pickup_point_address) {
        const parsed = parseSpanishAddress(order.pickup_point_address);
        recipientStreet = parsed.street || order.pickup_point_address;
        recipientCityName = parsed.city || order.pickup_point_city || '';
        recipientPostalCode = parsed.postalCode || order.pickup_point_postal_code || '';
    } else {
        const parsed = parseSpanishAddress(order.shipping_address || '');
        recipientStreet = parsed.street || order.shipping_address || '';
        recipientCityName = parsed.city || '';
        recipientPostalCode = parsed.postalCode || '';
    }

    const items = (order.order_items ?? []).flatMap((oi: any) => {
        const variant = Array.isArray(oi.product_variants) ? oi.product_variants[0] : oi.product_variants;
        if (!variant) return [];
        return [{
            weightKg: (variant as any).weight_kg,
            lengthCm: (variant as any).length_cm,
            widthCm: (variant as any).width_cm,
            heightCm: (variant as any).height_cm,
            quantity: oi.quantity,
        }];
    });

    const parcels = calculateParcelFromItems(items);

    try {
        const result = await createShipment({
            orderId: order.public_id,
            senderName,
            senderCompany,
            senderAddress: senderStreet,
            senderCity: senderCityName,
            senderPostalCode: senderPostalCode,
            senderCountry: senderCountry,
            senderPhone,
            senderEmail,
            recipientName: order.shipping_full_name || 'Cliente',
            recipientAddress: recipientStreet,
            recipientCity: recipientCityName,
            recipientPostalCode: recipientPostalCode,
            recipientCountry: 'ES',
            recipientPhone: order.shipping_phone || '',
            recipientEmail: order.buyer_email || '',
            parcels,
            requestedService: { shippingOptionCode },
            toServicePointId: isPickup ? (order.pickup_point_id || undefined) : undefined,
        });

        let storedLabelUrl = result.labelUrl;
        if (result.labelUrl) {
            try {
                const pdfBytes = await downloadSendcloudLabelPdf(result.labelUrl);
                storedLabelUrl = await uploadLabelPdf(order.public_id, pdfBytes);
            } catch (err) {
                console.warn(
                    'Sendcloud label download/upload failed, storing raw URL for later retry:',
                    err,
                );
            }
        }

        const adminClient = createSupabaseAdminClient();
        const { error: shipmentError } = await adminClient.rpc('create_shipment', {
            p_actor_id: user.id,
            p_order_id: orderId,
            p_sendcloud_shipment_id: result.shipmentId,
            p_sendcloud_reference: result.reference,
            p_carrier_id: shippingOptionCode,
            p_carrier_name: shippingOptionCode,
            p_service_name: shippingOptionCode,
            p_price: labelCost || result.price,
            p_tracking_number: result.trackingNumber,
            p_tracking_url: result.trackingUrl,
            p_label_url: storedLabelUrl,
        });

        if (shipmentError) {
            console.error('Failed to save shipment:', shipmentError);
        }

        await adminClient.rpc('mark_order_processing', { p_actor_id: user.id, p_order_id: orderId });

        await notifyBuyerReadyToSend(orderId, result.trackingUrl);

        return jsonResponse({
            success: true,
            shipmentId: result.shipmentId,
            reference: result.reference,
            labelUrl: result.labelUrl,
            trackingNumber: result.trackingNumber,
            trackingUrl: result.trackingUrl,
        }, 200);
    } catch (err) {
        console.error('Sendcloud create shipment error:', err);
        return jsonResponse({ error: 'Failed to create shipment' }, 500);
    }
};
