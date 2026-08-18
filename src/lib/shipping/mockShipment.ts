import { createSupabaseAdminClient } from '../core/supabase-admin';
import type { Strings } from '../core/i18n';
import { generateMockShippingLabel } from './shippingLabelPdf';
import { parseSpanishAddress } from './sendcloud';
import { uploadLabelPdf } from './labelStorage';
import type { createSupabaseAuthClient } from '../core/auth';
import { DELIVERY_TYPE } from '../orders/orderStatus';

type AuthClient = ReturnType<typeof createSupabaseAuthClient>;

export interface MockShipmentParams {
    userId: string;
    authClient: AuthClient;
    orderId: string;
    labelCost: number;
    t: Strings;
}

export interface MockShipmentSuccess {
    success: true;
    shipmentId: string;
    trackingNumber: string;
    trackingUrl: string;
    labelUrl: string;
    carrierName: string;
}

export interface MockShipmentFailure {
    success: false;
    status: number;
    error: string;
}

export type MockShipmentResult = MockShipmentSuccess | MockShipmentFailure;

/** The subset of an order returned by Convex for the staged shipment path. */
export interface ConvexShipmentContext {
    orderId: string;
    publicId: string;
    buyerEmail: string | null;
    deliveryType: 'home' | 'pickup_point' | null;
    shippingFullName: string | null;
    shippingPhone: string | null;
    shippingAddress: string | null;
    pickupPointId: string | null;
    pickupPointName: string | null;
    pickupPointAddress: string | null;
    pickupPointPostalCode: string | null;
    pickupPointCity: string | null;
    pickupPointCarrier: string | null;
    shop: { name: string; contactEmail: string | null };
    owner: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        phonePrefix: string | null;
        email: string;
        addressStreet: string | null;
        addressNumber: string | null;
        addressFloor: string | null;
        addressPostalCode: string | null;
        addressCity: string | null;
        addressCountry: string | null;
    };
    items: Array<{
        quantity: number;
        weightKg: number | null;
        lengthCm: number | null;
        widthCm: number | null;
        heightCm: number | null;
    }>;
}

export interface PersistConvexShipmentInput {
    orderId: string;
    sendcloudShipmentId: string;
    sendcloudReference: string;
    carrierId: string;
    carrierName: string;
    serviceName: string;
    priceCents: number;
    currency: string;
    trackingNumber: string;
    trackingUrl: string;
    labelUrl: string;
}

/**
 * Generates the local development label for a Convex order. Label bytes still
 * use the existing private Supabase Storage bucket during the storage cutover;
 * the order and shipment state itself is committed atomically in Convex.
 */
export async function runMockConvexShipment(params: {
    context: ConvexShipmentContext;
    labelCost: number;
    t: Strings;
    request: Request;
    persist: (input: PersistConvexShipmentInput) => Promise<void>;
}): Promise<MockShipmentResult> {
    const { context, labelCost, t, request, persist } = params;
    const owner = context.owner;
    const shop = context.shop;
    const isPickup = context.deliveryType === DELIVERY_TYPE.PICKUP_POINT;

    const senderStreet = [owner.addressStreet, owner.addressNumber, owner.addressFloor]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(' ');
    const senderName = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || shop.name;
    const senderCity = owner.addressCity ?? '';
    const senderPostal = owner.addressPostalCode ?? '';
    const senderCountry = owner.addressCountry || 'ES';
    const senderPhone = owner.phone
        ? `${owner.phonePrefix ?? '+34'}${owner.phone}`.replace(/\s+/g, '')
        : '';
    if (!senderStreet || !senderCity || !senderPostal || !senderName || !senderPhone) {
        return { success: false, status: 400, error: 'Completa los datos del vendedor antes de generar etiquetas' };
    }

    const recipientName = context.shippingFullName || 'Cliente';
    let recipientAddress = context.shippingAddress || '';
    let recipientCity = '';
    let recipientPostalCode = '';
    if (isPickup && context.pickupPointAddress) {
        const parsed = parseSpanishAddress(context.pickupPointAddress);
        recipientAddress = parsed.street || context.pickupPointAddress;
        recipientCity = parsed.city || context.pickupPointCity || '';
        recipientPostalCode = parsed.postalCode || context.pickupPointPostalCode || '';
    } else {
        const parsed = parseSpanishAddress(context.shippingAddress || '');
        recipientAddress = parsed.street || context.shippingAddress || '';
        recipientCity = parsed.city || '';
        recipientPostalCode = parsed.postalCode || '';
    }

    const carrierName = isPickup
        ? (context.pickupPointCarrier?.toLowerCase().includes('inpost') ? 'InPost' : 'Correos')
        : 'Correos';
    const serviceName = isPickup
        ? (carrierName === 'InPost' ? 'Punto Pack' : 'Punto de Recogida')
        : 'Envio a Domicilio (Paquete Azul)';
    const mockShipmentId = `MOCK-${Date.now()}`;
    const mockTracking = `TEST${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const trackingUrl = `https://track.${carrierName.toLowerCase().replace(/\s/g, '')}.com/?tracking=${mockTracking}`;

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = await generateMockShippingLabel({
            orderPublicId: context.publicId,
            senderName,
            senderAddress: senderStreet,
            senderCity,
            senderPostalCode: senderPostal,
            senderCountry,
            senderPhone,
            recipientName,
            recipientAddress,
            recipientCity,
            recipientPostalCode,
            recipientCountry: 'ES',
            recipientPhone: context.shippingPhone || '',
            carrierName,
            serviceName,
            trackingNumber: mockTracking,
            isPickupPoint: isPickup,
            pickupPointName: isPickup ? context.pickupPointName ?? undefined : undefined,
        });
    } catch (error) {
        console.error('mock Convex shipment: PDF generation failed', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    let labelUrl: string;
    try {
        labelUrl = await uploadLabelPdf(context.publicId, pdfBytes, request);
    } catch (error) {
        console.error('mock Convex shipment: storage error', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    try {
        await persist({
            orderId: context.orderId,
            sendcloudShipmentId: mockShipmentId,
            sendcloudReference: `REF-${context.publicId}`,
            carrierId: carrierName.toLowerCase(),
            carrierName,
            serviceName,
            priceCents: Math.round(labelCost * 100),
            currency: 'EUR',
            trackingNumber: mockTracking,
            trackingUrl,
            labelUrl,
        });
    } catch (error) {
        console.error('mock Convex shipment: state persistence failed', error);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    return {
        success: true,
        shipmentId: mockShipmentId,
        trackingNumber: mockTracking,
        trackingUrl,
        labelUrl: `/api/sendcloud/label?shipmentId=${encodeURIComponent(mockShipmentId)}`,
        carrierName,
    };
}

export async function runMockShipment(params: MockShipmentParams): Promise<MockShipmentResult> {
    const { userId, authClient, orderId, labelCost, t } = params;

    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', {
        p_order_id: orderId,
    });
    if (!hasAccess) {
        return { success: false, status: 403, error: t.apiForbidden };
    }

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
            pickup_point_carrier,
            shops!inner (
                name,
                owner:profiles!inner (
                    first_name,
                    last_name,
                    phone,
                    phone_prefix,
                    address_street,
                    address_number,
                    address_floor,
                    address_postal_code,
                    address_city,
                    address_country
                )
            )
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        console.error('mock-shipment: order lookup failed', orderError);
        return { success: false, status: 404, error: t.apiShopNotFound };
    }

    const shop = Array.isArray(order.shops) ? order.shops[0] : order.shops;
    const owner = shop && (Array.isArray(shop.owner) ? shop.owner[0] : shop.owner);
    if (!shop || !owner) {
        console.error('mock-shipment: shop/owner lookup failed');
        return { success: false, status: 404, error: t.apiShopNotFound };
    }

    const isPickup = order.delivery_type === DELIVERY_TYPE.PICKUP_POINT;

    const senderStreet = [owner.address_street, owner.address_number, owner.address_floor]
        .filter((p: string | null | undefined) => p && p.trim().length > 0)
        .join(' ');
    const senderName = `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || shop.name;
    const senderCity = owner.address_city ?? '';
    const senderPostal = owner.address_postal_code ?? '';
    const senderCountry = owner.address_country || 'ES';
    const senderPhone = owner.phone
        ? `${owner.phone_prefix ?? '+34'}${owner.phone}`.replace(/\s+/g, '')
        : '';

    if (!senderStreet || !senderCity || !senderPostal || !senderName || !senderPhone) {
        return {
            success: false,
            status: 400,
            error: 'Completa los datos del vendedor antes de generar etiquetas',
        };
    }

    const recipientName = order.shipping_full_name || 'Cliente';

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

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = await generateMockShippingLabel({
            orderPublicId: order.public_id,
            senderName,
            senderAddress: senderStreet,
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
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    let labelUrl: string;
    try {
        labelUrl = await uploadLabelPdf(order.public_id, pdfBytes);
    } catch (storageErr) {
        console.error('mock-shipment: storage error', storageErr);
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    const adminClient = createSupabaseAdminClient();

    const { error: shipmentError } = await adminClient.rpc('create_shipment', {
        p_actor_id: userId,
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
        return { success: false, status: 500, error: t.sellerOrderLabelError };
    }

    await adminClient.rpc('mark_order_processing', { p_actor_id: userId, p_order_id: orderId });

    return {
        success: true,
        shipmentId: mockShipmentId,
        trackingNumber: mockTracking,
        trackingUrl: `https://track.${carrierName.toLowerCase().replace(/\s/g, '')}.com/?tracking=${mockTracking}`,
        labelUrl: `/api/sendcloud/label?shipmentId=${encodeURIComponent(mockShipmentId)}`,
        carrierName,
    };
}
