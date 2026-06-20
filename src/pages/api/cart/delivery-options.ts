import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/core/supabase';
import { strings } from '../../../lib/core/i18n';
import {
    normalizeShippingPlatforms,
    intersectShippingPlatforms,
    servicePointCarriersForPlatforms,
    type ShippingPlatform,
} from '../../../lib/shipping/shippingPlatform';

interface RequestBody {
    variantIds?: unknown;
}

function jsonResponse(payload: unknown, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

/**
 * Returns the shipping options compatible with EVERY shop in the cart. Because
 * the buyer picks a single delivery method that is applied to all shops, an
 * option is only offered when all shops enable the underlying platform.
 *   - homeAvailable   → 'correos' enabled by all shops (home delivery)
 *   - pickupCarriers  → service-point carriers all shops support
 */
export const POST: APIRoute = async ({ request }) => {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const raw = Array.isArray(body.variantIds) ? body.variantIds : [];
    const variantIds = raw.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);

    if (variantIds.length === 0) {
        const all: ShippingPlatform[] = normalizeShippingPlatforms(null);
        return jsonResponse({
            platforms: all,
            homeAvailable: all.includes('correos'),
            pickupAvailable: true,
            pickupCarriers: servicePointCarriersForPlatforms(all),
        }, 200);
    }

    const { data, error } = await supabase
        .from('product_variants')
        .select(`
            id,
            products!inner ( shops!inner ( id, shipping_carriers ) )
        `)
        .in('id', variantIds);

    if (error) {
        return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 500);
    }

    type Row = {
        products: { shops: { id: string; shipping_carriers: string[] | null } | { id: string; shipping_carriers: string[] | null }[] | null }
            | { shops: { id: string; shipping_carriers: string[] | null } | { id: string; shipping_carriers: string[] | null }[] | null }[]
            | null;
    };

    const perShop = new Map<string, ShippingPlatform[]>();
    for (const row of (data ?? []) as Row[]) {
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        const shop = product && (Array.isArray(product.shops) ? product.shops[0] : product.shops);
        if (!shop?.id) continue;
        perShop.set(shop.id, normalizeShippingPlatforms(shop.shipping_carriers));
    }

    const platforms = intersectShippingPlatforms(Array.from(perShop.values()));
    const pickupCarriers = servicePointCarriersForPlatforms(platforms);

    return jsonResponse({
        platforms,
        homeAvailable: platforms.includes('correos'),
        pickupAvailable: pickupCarriers.length > 0,
        pickupCarriers,
    }, 200);
};
