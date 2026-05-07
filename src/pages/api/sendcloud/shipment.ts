import type { APIRoute } from 'astro';
import {
    createShipment,
    parseSpanishAddress,
    calculateParcelFromItems,
} from '../../../lib/shipping/sendcloud';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
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
        shippingOptionCode: string;
    };

    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const { orderId, shippingOptionCode } = body;

    if (!orderId || !shippingOptionCode) {
        return jsonResponse({ error: 'orderId and shippingOptionCode are required' }, 400);
    }

    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select(`
            id,
            public_id,
            buyer_email,
            shipping_full_name,
            shipping_phone,
            shipping_address,
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

    const senderAddress = process.env.SENDCLOUD_SENDER_ADDRESS || 'Calle Principal 1';
    const senderCountry = process.env.SENDCLOUD_SENDER_COUNTRY || 'ES';
    const senderPhone = process.env.SENDCLOUD_SENDER_PHONE || '+34600000000';
    const senderEmail = process.env.SENDCLOUD_SENDER_EMAIL || 'envios@fewya.com';
    const senderName = process.env.SENDCLOUD_SENDER_NAME || 'Fewya';
    const senderCompany = process.env.SENDCLOUD_SENDER_COMPANY || 'Fewya Marketplace';

    const { street: senderStreet, postalCode: senderPostalCode, city: senderCityName } = parseSpanishAddress(senderAddress);
    const { street: recipientStreet, postalCode: recipientPostalCode, city: recipientCityName } = parseSpanishAddress(order.shipping_address || '');

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
            senderAddress: `${senderStreet}, ${senderPostalCode} ${senderCityName}`,
            senderCity: senderCityName,
            senderPostalCode: senderPostalCode,
            senderCountry: senderCountry,
            senderPhone,
            senderEmail,
            recipientName: order.shipping_full_name || 'Cliente',
            recipientAddress: `${recipientStreet}, ${recipientPostalCode} ${recipientCityName}`,
            recipientCity: recipientCityName,
            recipientPostalCode: recipientPostalCode,
            recipientCountry: 'ES',
            recipientPhone: order.shipping_phone || '',
            recipientEmail: order.buyer_email || '',
            parcels,
            requestedService: { shippingOptionCode },
        });

        const { error: shipmentError } = await authClient.rpc('create_shipment', {
            p_order_id: orderId,
            p_sendcloud_shipment_id: result.shipmentId,
            p_sendcloud_reference: result.reference,
            p_carrier_id: shippingOptionCode,
            p_carrier_name: shippingOptionCode,
            p_service_name: shippingOptionCode,
            p_price: result.price,
            p_tracking_number: result.trackingNumber,
            p_tracking_url: result.trackingUrl,
            p_label_url: result.labelUrl,
        });

        if (shipmentError) {
            console.error('Failed to save shipment:', shipmentError);
        }

        // Mark order as processing
        await authClient.rpc('mark_order_processing', { p_order_id: orderId });

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
