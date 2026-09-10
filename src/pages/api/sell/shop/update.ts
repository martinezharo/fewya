import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

export const PATCH: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
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

    try {
        await convex.mutation(api.seller.updateShop, {
            profileImg: updates.profile_img,
            bannerImg: updates.banner_img,
        });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shop_update.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
