import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { strings } from '../../../../lib/core/i18n';
import { normalizeShippingPlatforms, isShippingPlatform } from '../../../../lib/shipping/shippingPlatform';

export const GET: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('default_weight_kg, default_length_cm, default_width_cm, default_height_cm, default_shipping_cost, shipping_carriers')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiShopNotFound }), { status: 404 });
    }

    return new Response(JSON.stringify({ shop }), { status: 200 });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiShopNotFound }), { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
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
            return new Response(JSON.stringify({ error: strings.sellerSettingsCarriersAtLeastOne }), { status: 400 });
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
