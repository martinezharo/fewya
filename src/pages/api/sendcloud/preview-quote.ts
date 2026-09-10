import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { getShippingQuotes, getConfig, type SendcloudShippingQuote } from '../../../lib/shipping/sendcloud';
import { categorize, CARRIER_META, type CarrierKey } from '../../../lib/shipping/carrierKey';
import { carrierKeyToPlatform, normalizeShippingPlatforms } from '../../../lib/shipping/shippingPlatform';
import { api } from '../../../../convex/_generated/api';

export type { CarrierKey };

interface CarrierEstimate {
    key: CarrierKey;
    label: string;
    sublabel: string;
    price: number | null;
    currency: string;
    serviceName: string | null;
    shippingOptionCode: string | null;
}

const IVA_RATE = 1.21;

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {

    // Only preview platforms this seller actually ships with.
    let enabledPlatforms: ReturnType<typeof normalizeShippingPlatforms>;
    const convex = createRequestConvexClient(request);
    if (!convex) return jsonResponse({ error: 'Unauthorized' }, 401);
    try {
        const seller = await convex.query(api.seller.current, {});
        if (!seller?.shop) return jsonResponse({ error: 'Shop not found' }, 404);
        enabledPlatforms = normalizeShippingPlatforms(seller.shop.shipping_carriers);
    } catch (error) {
        console.error('Convex preview shop lookup failed:', error);
        return jsonResponse({ error: 'Shop not found' }, 404);
    }

    let body: {
        weight_kg: number;
        length_cm?: number | null;
        width_cm?: number | null;
        height_cm?: number | null;
    };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const weight = Number(body.weight_kg);
    if (!Number.isFinite(weight) || weight <= 0) {
        return jsonResponse({ error: 'weight_kg required' }, 400);
    }

    const length = Number(body.length_cm) || 0;
    const width = Number(body.width_cm) || 0;
    const height = Number(body.height_cm) || 0;

    const volumetric = length > 0 && width > 0 && height > 0
        ? (length * width * height) / 5000
        : 0;
    const billable = Math.max(weight, volumetric);

    const config = getConfig();
    const fromPostalCode = config.senderPostalCode;
    const toPostalCode = '28001';

    let quotes: SendcloudShippingQuote[];
    try {
        quotes = await getShippingQuotes(fromPostalCode, 'ES', toPostalCode, 'ES', [
            {
                weight: billable,
                length: length || undefined,
                width: width || undefined,
                height: height || undefined,
            },
        ]);
    } catch (err) {
        console.error('Sendcloud preview-quote error:', err);
        return jsonResponse({ error: 'Failed to fetch shipping quotes' }, 502);
    }

    const buckets: Record<CarrierKey, SendcloudShippingQuote | null> = {
        inpost: null,
        correos_home: null,
        correos_pickup: null,
    };

    for (const q of quotes) {
        const key = categorize(q.carrierId, q.serviceName, q.servicePointInput);
        if (!key) continue;
        const current = buckets[key];
        if (!current || q.price < current.price) {
            buckets[key] = q;
        }
    }

    const order: CarrierKey[] = ['inpost', 'correos_home', 'correos_pickup'];
    const estimates: CarrierEstimate[] = order
        .filter((key) => enabledPlatforms.includes(carrierKeyToPlatform(key)))
        .map((key) => {
        const q = buckets[key];
        return {
            key,
            label: CARRIER_META[key].label,
            sublabel: CARRIER_META[key].sublabel,
            price: q ? Math.round(q.price * IVA_RATE * 100) / 100 : null,
            currency: q ? q.currency : 'EUR',
            serviceName: q ? q.serviceName : null,
            shippingOptionCode: q ? q.shippingOptionCode : null,
        };
    });

    return jsonResponse({ billableWeightKg: billable, estimates }, 200);
};
