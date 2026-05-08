import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { getWishlistIdsFromCookie } from '../../../lib/wishlist/wishlist';

type WishlistToggleBody = {
    productId?: unknown;
};

export const POST: APIRoute = async ({ cookies, request }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    const body = await request.json() as WishlistToggleBody;
    const productId = body?.productId;

    if (!productId || typeof productId !== 'string') {
        return new Response(JSON.stringify({ error: 'missing productId' }), { status: 400 });
    }

    const localIds = getWishlistIdsFromCookie(cookies);
    const isInLocal = localIds.includes(productId);

    // Check if already wishlisted in DB
    const { data: existing } = await authClient
        .from('wishlist')
        .select('id')
        .eq('profile_id', user.id)
        .eq('product_id', productId)
        .maybeSingle();

    if (existing) {
        // Remove from DB wishlist
        await authClient
            .from('wishlist')
            .delete()
            .eq('id', existing.id);

        // If it also exists locally, tell client to remove it there too
        if (isInLocal) {
            return new Response(
                JSON.stringify({ wishlisted: false, removedFromLocal: true }),
                { status: 200 }
            );
        }
        return new Response(JSON.stringify({ wishlisted: false }), { status: 200 });
    }

    if (isInLocal) {
        // Product is only in local wishlist — remove it from local
        return new Response(
            JSON.stringify({ wishlisted: false, removedFromLocal: true }),
            { status: 200 }
        );
    }

    // Add to DB wishlist
    await authClient
        .from('wishlist')
        .insert({ profile_id: user.id, product_id: productId });

    return new Response(JSON.stringify({ wishlisted: true }), { status: 200 });
};
