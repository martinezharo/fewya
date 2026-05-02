import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';

export const DELETE: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { error } = await supabase
        .from('shops')
        .delete()
        .eq('id', shop.id);

    if (error) {
        return new Response(JSON.stringify({ error: strings.sellerSettingsDeleteShopError }), {
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