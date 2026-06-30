import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { getWishlistIdsFromCookie } from '../../../lib/wishlist/wishlist';

type WishlistToggleBody = {
    productId?: unknown;
};

export const POST: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
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

    // A5: verify product exists and is active before inserting into wishlist
    const adminClient = createSupabaseAdminClient();
    const { data: product } = await adminClient
        .from('products')
        .select('id')
        .eq('id', productId)
        .eq('is_active', true)
        .maybeSingle();

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
        await authClient
            .from('wishlist')
            .delete()
            .eq('id', existing.id);

        if (isInLocal) {
            return new Response(
                JSON.stringify({ wishlisted: false, removedFromLocal: true }),
                { status: 200 }
            );
        }
        return new Response(JSON.stringify({ wishlisted: false }), { status: 200 });
    }

    if (isInLocal) {
        return new Response(
            JSON.stringify({ wishlisted: false, removedFromLocal: true }),
            { status: 200 }
        );
    }

    // Only insert if product is active
    if (!product) {
        return new Response(JSON.stringify({ error: t.apiProductNotFound }), { status: 404 });
    }

    await authClient
        .from('wishlist')
        .insert({ profile_id: user.id, product_id: productId });

    return new Response(JSON.stringify({ wishlisted: true }), { status: 200 });
};
