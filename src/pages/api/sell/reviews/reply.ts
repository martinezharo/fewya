import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../../lib/core/supabase-admin';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request, cookies  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    let body: { reviewId?: string; reply?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const { reviewId, reply } = body;
    if (!reviewId || typeof reply !== 'string') {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const adminClient = createSupabaseAdminClient();

    // Verify the review belongs to a product in the seller's shop
    const { data: review, error: reviewError } = await adminClient
        .from('reviews')
        .select('id, products:product_id (shop_id)')
        .eq('id', reviewId)
        .maybeSingle();

    if (reviewError || !review) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const product = Array.isArray(review.products) ? review.products[0] : review.products;
    const shopId = (product as any)?.shop_id;

    if (!shopId) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const { data: shop } = await adminClient
        .from('shops')
        .select('id')
        .eq('id', shopId)
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const trimmedReply = reply.trim();
    const { error: updateError } = await adminClient
        .from('reviews')
        .update({
            seller_reply: trimmedReply.length > 0 ? trimmedReply : null,
            seller_reply_at: trimmedReply.length > 0 ? new Date().toISOString() : null,
        })
        .eq('id', reviewId);

    if (updateError) {
        console.error('seller reply update error', updateError);
        return jsonResponse({ error: t.sellerReviewsReplyError }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
