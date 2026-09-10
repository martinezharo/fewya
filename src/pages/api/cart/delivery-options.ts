import type { APIRoute } from 'astro';
import { createConvexClient } from '../../../lib/core/convex';
import { api } from '../../../../convex/_generated/api';
import {
    normalizeShippingPlatforms,
    intersectShippingPlatforms,
    type ShippingPlatform,
} from '../../../lib/shipping/shippingPlatform';

interface RequestBody {
    variantIds?: unknown;
}

/**
 * The delivery options payload. The cart reads `platforms` and passes them
 * straight to the service-point search.
 */
function deliveryOptions(platforms: ShippingPlatform[]) {
    return {
        platforms,
        homeAvailable: platforms.includes('correos'),
        pickupAvailable: platforms.length > 0,
    };
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
 *   - platforms       → shipping platforms all shops support
 *   - homeAvailable   → 'correos' enabled by all shops (home delivery)
 *   - pickupAvailable → at least one platform left to search pickup points on
 */
export const POST: APIRoute = async ({ locals, request  }) => {
    const { t } = locals;
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const raw = Array.isArray(body.variantIds) ? body.variantIds : [];
    const variantIds = raw.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);

    if (variantIds.length === 0) {
        return jsonResponse(deliveryOptions(normalizeShippingPlatforms(null)), 200);
    }

    const convex = createConvexClient();
    if (!convex) return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 503);
    try {
        const data = await convex.query(api.catalog.getCartVariants, { ids: variantIds });
        const perShop = new Map<string, ShippingPlatform[]>();
        for (const row of data) perShop.set(row.product.shop.id, normalizeShippingPlatforms(row.product.shop.shipping_carriers));
        return jsonResponse(deliveryOptions(intersectShippingPlatforms(Array.from(perShop.values()))), 200);
    } catch (error) {
        console.error(JSON.stringify({ event: 'cart_delivery.failed', error: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 500);
    }
};
