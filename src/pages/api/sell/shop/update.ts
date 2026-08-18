import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { getRequestConvexToken } from '../../../../lib/core/auth';
import { createConvexClient } from '../../../../lib/core/convex';
import { api } from '../../../../../convex/_generated/api';
import { convexOnly } from '../../../../lib/core/env';

export const PATCH: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    const allowedFields = ['profile_img', 'banner_img'];
    const updates: Record<string, string | null> = {};

    for (const field of allowedFields) {
        if (field in body) {
            updates[field] = (body[field] as string) ?? null;
        }
    }

    if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
        try {
            await convex.mutation(api.seller.updateShop, {
                profileImg: updates.profile_img,
                bannerImg: updates.banner_img,
            });
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        } catch (error) {
            console.error(JSON.stringify({ event: 'seller_shop_update.convex_failed', error: error instanceof Error ? error.message : String(error) }));
            return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
        }
    }

    const { error } = await supabase
        .from('shops')
        .update(updates)
        .eq('owner_id', user.id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};
