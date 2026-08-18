import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { getRequestConvexToken } from '../../../../lib/core/auth';
import { createConvexClient } from '../../../../lib/core/convex';
import { api } from '../../../../../convex/_generated/api';
import { convexOnly } from '../../../../lib/core/env';

import { enforceVariantPricing, type PricingCheckVariant } from '../../../../lib/products/pricingEnforcement';

export const PATCH: APIRoute = async ({ locals, cookies, request, url  }) => {
    const { t, locale } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    let body: { is_active: boolean };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
        try {
            const result = await convex.mutation(api.seller.toggleProduct, { productId, isActive: body.is_active });
            return new Response(JSON.stringify({ product: result.product }), { status: 200 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ error: message.includes('access') ? t.apiForbidden : t.apiInternalError }), { status: message.includes('access') ? 403 : 500 });
        }
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id, allow_loss')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    }

    if (body.is_active === true && !shop.allow_loss) {
        const { data: variants } = await supabase
            .from('product_variants')
            .select('variant_name, price, shipping_cost, weight_kg, length_cm, width_cm, height_cm')
            .eq('product_id', productId);

        const pricing = await enforceVariantPricing(t, locale, (variants ?? []) as PricingCheckVariant[]);
        if (!pricing.ok) {
            return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
        }
    }

    const { data: product, error } = await supabase
        .from('products')
        .update({ is_active: body.is_active })
        .eq('id', productId)
        .eq('shop_id', shop.id)
        .select()
        .single();

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!product) {
        return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    }

    return new Response(JSON.stringify({ product }), { status: 200 });
};
