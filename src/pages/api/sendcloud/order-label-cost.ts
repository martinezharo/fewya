import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import {
    getShippingQuotes,
    getConfig,
    calculateParcelFromItems,
    parseSpanishAddress,
    type SendcloudShippingQuote,
} from '../../../lib/shipping/sendcloud';
import { categorize, CARRIER_META, type CarrierKey } from '../../../lib/shipping/carrierKey';
import { getCarrierSubsidy } from '../../../lib/cart/checkout';
import { DELIVERY_TYPE } from '../../../lib/orders/orderStatus';

const IVA_RATE = 1.21;

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function resolveExpectedBucket(
    deliveryType: string | null | undefined,
    pickupPointCarrier: string | null | undefined,
): CarrierKey | null {
    if (deliveryType === DELIVERY_TYPE.HOME) return 'correos_home';
    if (deliveryType === DELIVERY_TYPE.PICKUP_POINT) {
        const carrier = (pickupPointCarrier || '').toLowerCase();
        if (carrier.includes('inpost')) return 'inpost';
        if (carrier.includes('correos')) return 'correos_pickup';
        return 'correos_pickup';
    }
    return null;
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const orderId = url.searchParams.get('orderId');
    if (!orderId) return jsonResponse({ error: 'orderId required' }, 400);

    const { data: hasAccess } = await authClient.rpc('order_belongs_to_seller', { p_order_id: orderId });
    if (!hasAccess) return jsonResponse({ error: 'Forbidden' }, 403);

    const { data: order, error: orderError } = await authClient
        .from('orders')
        .select(`
            id,
            delivery_type,
            pickup_point_carrier,
            pickup_point_name,
            pickup_point_postal_code,
            pickup_point_address,
            shipping_address,
            order_items (
                quantity,
                product_variants (
                    weight_kg,
                    length_cm,
                    width_cm,
                    height_cm,
                    shipping_cost
                )
            )
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: 'Order not found' }, 404);
    }

    const expectedBucket = resolveExpectedBucket(order.delivery_type, order.pickup_point_carrier);
    console.log('[order-label-cost] order context', {
        orderId,
        delivery_type: order.delivery_type,
        pickup_point_carrier: order.pickup_point_carrier,
        pickup_point_postal_code: order.pickup_point_postal_code,
        expectedBucket,
    });
    if (!expectedBucket) {
        console.warn('[order-label-cost] expectedBucket could not be resolved');
        return jsonResponse({
            unavailable: true,
            error: 'No se puede determinar el tipo de entrega del pedido.',
        }, 200);
    }

    const items = (order.order_items ?? []).flatMap((oi: any) => {
        const variant = Array.isArray(oi.product_variants) ? oi.product_variants[0] : oi.product_variants;
        if (!variant) return [];
        return [{
            weightKg: variant.weight_kg,
            lengthCm: variant.length_cm,
            widthCm: variant.width_cm,
            heightCm: variant.height_cm,
            quantity: oi.quantity,
        }];
    });

    if (items.length === 0) {
        return jsonResponse({ unavailable: true, error: 'El pedido no tiene artículos válidos.' }, 200);
    }

    const buyerPaidShipping = (order.order_items ?? []).reduce((acc: number, oi: any) => {
        const variant = Array.isArray(oi.product_variants) ? oi.product_variants[0] : oi.product_variants;
        const cost = Number(variant?.shipping_cost ?? 0);
        return Math.max(acc, cost);
    }, 0);

    const config = getConfig();
    const senderPostalCode = config.senderPostalCode;

    let recipientPostalCode = '';
    if (order.delivery_type === DELIVERY_TYPE.PICKUP_POINT) {
        recipientPostalCode = order.pickup_point_postal_code
            || parseSpanishAddress(order.pickup_point_address || '').postalCode
            || '';
    } else {
        recipientPostalCode = parseSpanishAddress(order.shipping_address || '').postalCode;
    }

    if (!recipientPostalCode) {
        return jsonResponse({
            unavailable: true,
            error: 'No se pudo determinar el código postal de destino.',
        }, 200);
    }

    const parcels = calculateParcelFromItems(items);
    console.log('[order-label-cost] quote request', {
        senderPostalCode,
        recipientPostalCode,
        items,
        parcels,
    });

    let quotes: SendcloudShippingQuote[];
    try {
        quotes = await getShippingQuotes(senderPostalCode, 'ES', recipientPostalCode, 'ES', parcels);
    } catch (err) {
        console.error('[order-label-cost] Sendcloud quote error', err);
        return jsonResponse({
            unavailable: true,
            error: 'No hemos podido obtener tarifas de Sendcloud.',
        }, 200);
    }
    console.log('[order-label-cost] quotes received', {
        count: quotes.length,
        quotes: quotes.map((q) => ({
            carrierId: q.carrierId,
            serviceName: q.serviceName,
            servicePointInput: q.servicePointInput,
            shippingOptionCode: q.shippingOptionCode,
            price: q.price,
        })),
    });

    const buckets: Record<CarrierKey, SendcloudShippingQuote | null> = {
        inpost: null,
        correos_home: null,
        correos_pickup: null,
    };

    const categorization: Array<{ carrierId: string; serviceName: string; servicePointInput: unknown; price: number; key: CarrierKey | null }> = [];
    for (const q of quotes) {
        const key = categorize(q.carrierId, q.serviceName, q.servicePointInput);
        categorization.push({
            carrierId: q.carrierId,
            serviceName: q.serviceName,
            servicePointInput: q.servicePointInput,
            price: q.price,
            key,
        });
        if (!key) continue;
        const current = buckets[key];
        if (!current || q.price < current.price) {
            buckets[key] = q;
        }
    }
    console.log('[order-label-cost] categorization', categorization);
    console.log('[order-label-cost] buckets', {
        inpost: buckets.inpost ? { serviceName: buckets.inpost.serviceName, price: buckets.inpost.price } : null,
        correos_home: buckets.correos_home ? { serviceName: buckets.correos_home.serviceName, price: buckets.correos_home.price } : null,
        correos_pickup: buckets.correos_pickup ? { serviceName: buckets.correos_pickup.serviceName, price: buckets.correos_pickup.price } : null,
        expectedBucket,
    });

    const chosen = buckets[expectedBucket];
    if (!chosen) {
        console.warn('[order-label-cost] no quote in expected bucket', {
            expectedBucket,
            availableBuckets: Object.entries(buckets).filter(([, v]) => v !== null).map(([k]) => k),
        });
        return jsonResponse({
            unavailable: true,
            carrierKey: expectedBucket,
            carrierLabel: CARRIER_META[expectedBucket].label,
            buyerPaidShipping,
            error: 'No hay tarifa disponible para este transportista ahora mismo.',
        }, 200);
    }

    const grossPrice = Math.round(chosen.price * IVA_RATE * 100) / 100;
    const subsidy = getCarrierSubsidy(expectedBucket);
    const netDeduction = Math.max(0, Math.round((grossPrice - subsidy) * 100) / 100);

    return jsonResponse({
        carrierKey: expectedBucket,
        carrierLabel: CARRIER_META[expectedBucket].label,
        serviceName: chosen.serviceName,
        shippingOptionCode: chosen.shippingOptionCode,
        grossPrice,
        subsidy,
        netDeduction,
        buyerPaidShipping: Math.round(buyerPaidShipping * 100) / 100,
        pickupPointName: order.pickup_point_name ?? null,
        currency: 'EUR',
    }, 200);
};
