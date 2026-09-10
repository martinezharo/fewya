import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';
import {
    getShippingQuotes,
    getConfig,
    calculateParcelFromItems,
    parseSpanishAddress,
    type SendcloudShippingQuote,
} from '../../../lib/shipping/sendcloud';
import { categorize, CARRIER_META, type CarrierKey } from '../../../lib/shipping/carrierKey';
import { platformForServicePointCarrier } from '../../../lib/shipping/shippingPlatform';
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
        return platformForServicePointCarrier(pickupPointCarrier) === 'inpost' ? 'inpost' : 'correos_pickup';
    }
    return null;
}

export const GET: APIRoute = async ({ request, url }) => {
    // Seller ownership of the order is enforced by Convex.
    const convex = createRequestConvexClient(request);
    if (!convex) return jsonResponse({ error: 'Unauthorized' }, 401);

    const orderId = url.searchParams.get('orderId');
    if (!orderId) return jsonResponse({ error: 'orderId required' }, 400);

    try {
        const order = await convex.query(api.orders.getShipmentContext, { orderId });
        const expectedBucket = resolveExpectedBucket(order.deliveryType, order.pickupPointCarrier);
        if (!expectedBucket) return jsonResponse({ unavailable: true, error: 'No se puede determinar el tipo de entrega del pedido.' }, 200);
        if (order.items.length === 0) return jsonResponse({ unavailable: true, error: 'El pedido no tiene artículos válidos.' }, 200);

        const items = order.items.map((item) => ({
            weightKg: item.weightKg ?? undefined,
            lengthCm: item.lengthCm ?? undefined,
            widthCm: item.widthCm ?? undefined,
            heightCm: item.heightCm ?? undefined,
            quantity: item.quantity,
        }));
        const buyerPaidShipping = order.items.reduce((max, item) => Math.max(max, item.shippingCostCents / 100), 0);
        const config = getConfig();
        const recipientPostalCode = order.deliveryType === DELIVERY_TYPE.PICKUP_POINT
            ? order.pickupPointPostalCode || parseSpanishAddress(order.pickupPointAddress || '').postalCode || ''
            : parseSpanishAddress(order.shippingAddress || '').postalCode;
        if (!recipientPostalCode) return jsonResponse({ unavailable: true, error: 'No se pudo determinar el código postal de destino.' }, 200);

        const quotes = await getShippingQuotes(config.senderPostalCode, 'ES', recipientPostalCode, 'ES', calculateParcelFromItems(items));
        const buckets: Record<CarrierKey, SendcloudShippingQuote | null> = { inpost: null, correos_home: null, correos_pickup: null };
        for (const quote of quotes) {
            const key = categorize(quote.carrierId, quote.serviceName, quote.servicePointInput);
            if (!key) continue;
            if (!buckets[key] || quote.price < buckets[key]!.price) buckets[key] = quote;
        }
        const chosen = buckets[expectedBucket];
        if (!chosen) return jsonResponse({ unavailable: true, carrierKey: expectedBucket, carrierLabel: CARRIER_META[expectedBucket].label, buyerPaidShipping, error: 'No hay tarifa disponible para este transportista ahora mismo.' }, 200);
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
            pickupPointName: order.pickupPointName ?? null,
            currency: 'EUR',
        }, 200);
    } catch (error) {
        console.error('[order-label-cost] Convex lookup/quote error', error);
        return jsonResponse({ unavailable: true, error: 'No hemos podido obtener tarifas de Sendcloud.' }, 200);
    }
};
