import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { getRequestConvexToken } from '../../../../lib/core/auth';
import { createConvexClient } from '../../../../lib/core/convex';
import { api } from '../../../../../convex/_generated/api';
import { convexOnly } from '../../../../lib/core/env';

import { normalizeShippingPlatforms, isShippingPlatform } from '../../../../lib/shipping/shippingPlatform';

export const GET: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
        try {
            const seller = await convex.query(api.seller.current, {});
            if (!seller?.shop) return new Response(JSON.stringify({ error: t.apiShopNotFound }), { status: 404 });
            return new Response(JSON.stringify({ shop: seller.shop }), { status: 200 });
        } catch (error) {
            console.error(JSON.stringify({ event: 'seller_shipping.convex_get_failed', error: error instanceof Error ? error.message : String(error) }));
            return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
        }
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('default_weight_kg, default_length_cm, default_width_cm, default_height_cm, default_shipping_cost, shipping_carriers')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: t.apiShopNotFound }), { status: 404 });
    }

    return new Response(JSON.stringify({ shop }), { status: 200 });
};

export const PATCH: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
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
            console.error(JSON.stringify({ event: 'seller_shipping.convex_update_failed', error: error instanceof Error ? error.message : String(error) }));
            return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
        }
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: t.apiShopNotFound }), { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.default_weight_kg !== undefined) updates.default_weight_kg = body.default_weight_kg === null || body.default_weight_kg === '' ? null : Number(body.default_weight_kg);
    if (body.default_length_cm !== undefined) updates.default_length_cm = body.default_length_cm === null || body.default_length_cm === '' ? null : Number(body.default_length_cm);
    if (body.default_width_cm !== undefined) updates.default_width_cm = body.default_width_cm === null || body.default_width_cm === '' ? null : Number(body.default_width_cm);
    if (body.default_height_cm !== undefined) updates.default_height_cm = body.default_height_cm === null || body.default_height_cm === '' ? null : Number(body.default_height_cm);
    if (body.default_shipping_cost !== undefined) updates.default_shipping_cost = body.default_shipping_cost === null || body.default_shipping_cost === '' ? null : Number(body.default_shipping_cost);

    if (body.shipping_carriers !== undefined) {
        const raw = body.shipping_carriers;
        if (!Array.isArray(raw) || !raw.every(isShippingPlatform) || raw.length === 0) {
            return new Response(JSON.stringify({ error: t.sellerSettingsCarriersAtLeastOne }), { status: 400 });
        }
        updates.shipping_carriers = normalizeShippingPlatforms(raw);
    }

    const { error } = await supabase
        .from('shops')
        .update(updates)
        .eq('id', shop.id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
