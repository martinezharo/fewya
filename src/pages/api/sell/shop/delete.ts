import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { strings } from '../../../../lib/core/i18n';

export const DELETE: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

    if (shopError || !shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Soft-delete: mark shop as inactive instead of hard DELETE
    const { error: updateError } = await supabase
        .from('shops')
        .update({ status: 'inactive' })
        .eq('id', shop.id);

    if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Deactivate all products so they disappear from public listings
    await supabase
        .from('products')
        .update({ is_active: false })
        .eq('shop_id', shop.id);

    await supabase
        .from('profiles')
        .update({ is_seller: false })
        .eq('id', user.id);

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
