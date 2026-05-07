import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';

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

    // Check if already wishlisted
    const { data: existing } = await authClient
        .from('wishlist')
        .select('id')
        .eq('profile_id', user.id)
        .eq('product_id', productId)
        .maybeSingle();

    if (existing) {
        // Remove from wishlist
        await authClient
            .from('wishlist')
            .delete()
            .eq('id', existing.id);

        return new Response(JSON.stringify({ wishlisted: false }), { status: 200 });
    }

    // Add to wishlist
    await authClient
        .from('wishlist')
        .insert({ profile_id: user.id, product_id: productId });

    return new Response(JSON.stringify({ wishlisted: true }), { status: 200 });
};
