import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';

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
        .maybeSingle();

    if (shopError || !shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { error: deleteError } = await supabase
        .from('shops')
        .delete()
        .eq('id', shop.id);

    if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    await supabase
        .from('profiles')
        .update({ is_seller: false })
        .eq('id', user.id);

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}