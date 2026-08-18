import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { getRequestConvexToken } from '../../../../lib/core/auth';
import { createConvexClient } from '../../../../lib/core/convex';
import { api } from '../../../../../convex/_generated/api';
import { convexOnly } from '../../../../lib/core/env';

import { SHOP_STATUS } from '../../../../lib/core/shopStatus';

export const DELETE: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        try {
            await convex.mutation(api.seller.deleteShop, {});
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            console.error(JSON.stringify({ event: 'seller_shop_delete.convex_failed', error: error instanceof Error ? error.message : String(error) }));
            return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
    }

    const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .eq('status', SHOP_STATUS.ACTIVE)
        .maybeSingle();

    if (shopError || !shop) {
        return new Response(JSON.stringify({ error: t.apiForbidden }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Soft-delete: mark shop as inactive instead of hard DELETE
    const { error: updateError } = await supabase
        .from('shops')
        .update({ status: SHOP_STATUS.INACTIVE })
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
