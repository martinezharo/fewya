import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { normalizeShippingPlatforms, isShippingPlatform } from '../../../../lib/shipping/shippingPlatform';

export const GET: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    try {
        const seller = await convex.query(api.seller.current, {});
        if (!seller?.shop) return new Response(JSON.stringify({ error: t.apiShopNotFound }), { status: 404 });
        return new Response(JSON.stringify({ shop: seller.shop }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shipping.get_failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};

export const PATCH: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 }); }
    const parse = (key: string) => body[key] === undefined || body[key] === null || body[key] === '' ? undefined : Number(body[key]);
    const carriers = body.shipping_carriers;
    if (carriers !== undefined && (!Array.isArray(carriers) || !carriers.every(isShippingPlatform) || carriers.length === 0)) {
        return new Response(JSON.stringify({ error: t.sellerSettingsCarriersAtLeastOne }), { status: 400 });
    }
    try {
        await convex.mutation(api.seller.updateShipping, {
            defaultWeightKg: parse('default_weight_kg'),
            defaultLengthCm: parse('default_length_cm'),
            defaultWidthCm: parse('default_width_cm'),
            defaultHeightCm: parse('default_height_cm'),
            defaultShippingCostCents: body.default_shipping_cost === undefined || body.default_shipping_cost === null || body.default_shipping_cost === '' ? undefined : Math.round(Number(body.default_shipping_cost) * 100),
            shippingCarriers: carriers === undefined ? undefined : normalizeShippingPlatforms(carriers),
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shipping.update_failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
