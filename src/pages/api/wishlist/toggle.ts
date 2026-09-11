import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';

type WishlistToggleBody = {
    productId?: unknown;
};

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    // Parsing has to be guarded: a malformed body is the caller's mistake, and
    // letting it throw turns a 400 into an unhandled 500.
    let body: WishlistToggleBody;
    try {
        body = await request.json() as WishlistToggleBody;
    } catch {
        return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 });
    }

    const productId = body?.productId;
    if (!productId || typeof productId !== 'string') {
        return new Response(JSON.stringify({ error: 'missing productId' }), { status: 400 });
    }

    try {
        // Convex checks the product exists and is active before storing it.
        const result = await convex.mutation(api.wishlist.toggle, { productLegacyId: productId });
        return new Response(JSON.stringify({ wishlisted: result.wished }), { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('product not found')) {
            return new Response(JSON.stringify({ error: t.apiProductNotFound }), { status: 404 });
        }
        console.error(JSON.stringify({ event: 'wishlist.toggle_failed', error: message }));
        return new Response(JSON.stringify({ error: 'wishlist unavailable' }), { status: 503 });
    }
};
