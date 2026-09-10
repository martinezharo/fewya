import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';


export const DELETE: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await convex.mutation(api.seller.deleteShop, {});
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shop_delete.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
};
