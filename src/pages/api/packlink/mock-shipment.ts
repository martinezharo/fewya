import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Generates a mock shipping label for testing without calling Packlink.
 * Creates a fake shipment record so sellers can test the full flow.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    // Verify seller owns this order
    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
        p_order_id: orderId,
    });

    if (!hasAccess) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    // Get order details
    const { data: order } = await authClient
        .from('orders')
        .select('public_id, shipping_full_name, shipping_address')
        .eq('id', orderId)
        .single();

    if (!order) {
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    const mockShipmentId = `MOCK-${Date.now()}`;
    const mockTracking = `TEST${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const mockReference = `REF-${order.public_id}`;

    // Generate a simple test PDF URL (using a public test PDF)
    const mockLabelUrl = `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`;

    // Save mock shipment to DB
    const { data: shipment, error: shipmentError } = await authClient.rpc('create_shipment', {
        p_order_id: orderId,
        p_packlink_shipment_id: mockShipmentId,
        p_packlink_reference: mockReference,
        p_carrier_id: 'seur_mock',
        p_carrier_name: 'SEUR Prueba',
        p_service_name: 'Envío estándar (TEST)',
        p_price: 0,
        p_tracking_number: mockTracking,
        p_tracking_url: `https://track.seur.com/?tracking=${mockTracking}`,
        p_label_url: mockLabelUrl,
    });

    if (shipmentError) {
        console.error('mock shipment creation failed', shipmentError);
        return jsonResponse({ error: strings.sellerOrderLabelError }, 500);
    }

    // Update order status to processing via RPC (bypasses RLS)
    await authClient.rpc('mark_order_processing', { p_order_id: orderId });

    return jsonResponse({
        success: true,
        shipmentId: mockShipmentId,
        trackingNumber: mockTracking,
        trackingUrl: `https://track.seur.com/?tracking=${mockTracking}`,
        labelUrl: mockLabelUrl,
        carrierName: 'SEUR Prueba',
    }, 200);
};
