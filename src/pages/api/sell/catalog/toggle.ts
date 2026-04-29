import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    let body: { is_active: boolean };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
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
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    return new Response(JSON.stringify({ product }), { status: 200 });
};