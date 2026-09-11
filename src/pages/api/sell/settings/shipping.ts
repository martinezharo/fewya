import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { normalizeShippingPlatforms, isShippingPlatform } from '../../../../lib/shipping/shippingPlatform';
import { optionalNumber, requireObject } from '../../../../lib/core/requestFields';

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
    try {
        body = requireObject('body', await request.json());
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    const carriers = body.shipping_carriers;
    if (carriers !== undefined && (!Array.isArray(carriers) || !carriers.every(isShippingPlatform) || carriers.length === 0)) {
        return new Response(JSON.stringify({ error: t.sellerSettingsCarriersAtLeastOne }), { status: 400 });
    }

    // A blank input clears the default; anything else has to be a real number.
    // `Number('heavy')` is NaN, which both `typeof` and Convex's `v.number()`
    // accept, so it would otherwise be stored as the shop's default weight and
    // poison every carrier quote derived from it.
    let defaults: Record<string, number | null>;
    try {
        defaults = {
            weight: optionalNumber('default_weight_kg', body.default_weight_kg),
            length: optionalNumber('default_length_cm', body.default_length_cm),
            width: optionalNumber('default_width_cm', body.default_width_cm),
            height: optionalNumber('default_height_cm', body.default_height_cm),
            shippingCost: optionalNumber('default_shipping_cost', body.default_shipping_cost),
        };
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    try {
        await convex.mutation(api.seller.updateShipping, {
            defaultWeightKg: defaults.weight ?? undefined,
            defaultLengthCm: defaults.length ?? undefined,
            defaultWidthCm: defaults.width ?? undefined,
            defaultHeightCm: defaults.height ?? undefined,
            defaultShippingCostCents: defaults.shippingCost === null ? undefined : Math.round(defaults.shippingCost * 100),
            shippingCarriers: carriers === undefined ? undefined : normalizeShippingPlatforms(carriers),
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shipping.update_failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
