import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';

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

    const { error } = await supabase
        .from('shops')
        .update(updates)
        .eq('owner_id', user.id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};