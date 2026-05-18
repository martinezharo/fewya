import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { generateMockShippingLabel } from '../../../lib/shipping/shippingLabelPdf';
import { parseSpanishAddress } from '../../../lib/shipping/sendcloud';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Generates a mock shipping label PDF for testing without calling Sendcloud.
 * Differentiates between home delivery and pickup point.
 * Uploads the PDF to Supabase Storage and creates a shipment record.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { orderId?: string; labelCost?: number };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const labelCost = Number.isFinite(body.labelCost) && (body.labelCost as number) >= 0
        ? Math.round((body.labelCost as number) * 100) / 100
        : 0;

    // Verify seller owns this order
    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
        p_order_id: orderId,
    });

    if (!hasAccess) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    // Get order details
    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select(`
            id,
            public_id,
            shop_id,
            delivery_type,
            shipping_full_name,
            shipping_phone,
            shipping_address,
            pickup_point_name,
            pickup_point_address,
            pickup_point_postal_code,
            pickup_point_city,
            pickup_point_carrier
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        console.error('mock-shipment: order lookup failed', orderError);
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    // Get shop (sender) details
    const { data: shop, error: shopError } = await authClient
        .from('shops')
        .select('name, location, contact_email, whatsapp')
        .eq('id', order.shop_id)
        .single();

    if (shopError || !shop) {
        console.error('mock-shipment: shop lookup failed', shopError);
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    const isPickup = order.delivery_type === 'pickup_point';

    // Build sender info
    const senderName = shop.name || 'Fewya Seller';
    const senderAddress = shop.location || process.env.SENDCLOUD_SENDER_ADDRESS || 'Calle Principal 1';
    const senderPhone = shop.whatsapp || process.env.SENDCLOUD_SENDER_PHONE || '+34600000000';
    const { street: senderStreet, postalCode: senderPostalCode, city: senderCityName } = parseSpanishAddress(senderAddress);
    const senderCity = senderCityName || process.env.SENDCLOUD_SENDER_CITY || 'Madrid';
    const senderPostal = senderPostalCode || process.env.SENDCLOUD_SENDER_POSTAL_CODE || '28001';
    const senderCountry = process.env.SENDCLOUD_SENDER_COUNTRY || 'ES';

    // Build recipient info
    const recipientName = isPickup
        ? (order.shipping_full_name || 'Cliente')
        : (order.shipping_full_name || 'Cliente');

    let recipientAddress = order.shipping_address || '';
    let recipientCity = '';
    let recipientPostalCode = '';

    if (isPickup && order.pickup_point_address) {
        const parsed = parseSpanishAddress(order.pickup_point_address);
        recipientAddress = parsed.street || order.pickup_point_address;
        recipientCity = parsed.city || order.pickup_point_city || '';
        recipientPostalCode = parsed.postalCode || order.pickup_point_postal_code || '';
    } else {
        const parsed = parseSpanishAddress(order.shipping_address || '');
        recipientAddress = parsed.street || order.shipping_address || '';
        recipientCity = parsed.city || '';
        recipientPostalCode = parsed.postalCode || '';
    }

    const recipientCountry = 'ES';
    const recipientPhone = order.shipping_phone || '';

    // Determine carrier and service name based on delivery type
    let carrierName: string;
    let serviceName: string;

    if (isPickup) {
        const carrier = order.pickup_point_carrier || 'correos';
        if (carrier.toLowerCase().includes('inpost')) {
            carrierName = 'InPost';
            serviceName = 'Punto Pack';
        } else {
            carrierName = 'Correos';
            serviceName = 'Punto de Recogida';
        }
    } else {
        carrierName = 'Correos';
        serviceName = 'Envio a Domicilio (Paquete Azul)';
    }

    const mockShipmentId = `MOCK-${Date.now()}`;
    const mockTracking = `TEST${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const mockReference = `REF-${order.public_id}`;

    // Generate PDF
    let pdfBytes: Uint8Array;
    try {
        pdfBytes = await generateMockShippingLabel({
            orderPublicId: order.public_id,
            senderName,
            senderAddress: senderStreet || senderAddress,
            senderCity,
            senderPostalCode: senderPostal,
            senderCountry,
            senderPhone,
            recipientName,
            recipientAddress,
            recipientCity,
            recipientPostalCode,
            recipientCountry,
            recipientPhone,
            carrierName,
            serviceName,
            trackingNumber: mockTracking,
            isPickupPoint: isPickup,
            pickupPointName: isPickup ? order.pickup_point_name : undefined,
        });
    } catch (pdfErr) {
        console.error('mock-shipment: PDF generation failed', pdfErr);
        return jsonResponse({ error: strings.sellerOrderLabelError }, 500);
    }

    // Upload PDF to Supabase Storage (use admin client to bypass RLS;
    // ownership is already verified above via order_belongs_to_seller.)
    const labelPath = `${orderId}/${crypto.randomUUID()}.pdf`;
    let labelUrl: string;
    const adminClient = createSupabaseAdminClient();

    try {
        const { error: uploadError } = await adminClient.storage
            .from('labels')
            .upload(labelPath, pdfBytes, {
                contentType: 'application/pdf',
                upsert: false,
            });

        if (uploadError) {
            console.error('mock-shipment: storage upload failed', uploadError);
            return jsonResponse({ error: strings.sellerOrderLabelError }, 500);
        }

        labelUrl = `labels:${labelPath}`;
    } catch (storageErr) {
        console.error('mock-shipment: storage error', storageErr);
        return jsonResponse({ error: strings.sellerOrderLabelError }, 500);
    }

    // Save mock shipment to DB
    const { error: shipmentError } = await adminClient.rpc('create_shipment', {
        p_actor_id: user.id,
        p_order_id: orderId,
        p_sendcloud_shipment_id: mockShipmentId,
        p_sendcloud_reference: mockReference,
        p_carrier_id: carrierName.toLowerCase(),
        p_carrier_name: carrierName,
        p_service_name: serviceName,
        p_price: labelCost,
        p_tracking_number: mockTracking,
        p_tracking_url: `https://track.${carrierName.toLowerCase().replace(/\s/g, '')}.com/?tracking=${mockTracking}`,
        p_label_url: labelUrl,
    });

    if (shipmentError) {
        console.error('mock shipment creation failed', shipmentError);
        return jsonResponse({ error: strings.sellerOrderLabelError }, 500);
    }

    // Update order status to processing via RPC (bypasses RLS)
    await adminClient.rpc('mark_order_processing', { p_actor_id: user.id, p_order_id: orderId });

    return jsonResponse({
        success: true,
        shipmentId: mockShipmentId,
        trackingNumber: mockTracking,
        trackingUrl: `https://track.${carrierName.toLowerCase().replace(/\s/g, '')}.com/?tracking=${mockTracking}`,
        labelUrl: `/api/sendcloud/label?shipmentId=${encodeURIComponent(mockShipmentId)}`,
        carrierName,
    }, 200);
};
