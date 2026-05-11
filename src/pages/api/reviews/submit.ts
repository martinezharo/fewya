import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { productId?: string; rating?: number; comment?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const { productId, rating, comment } = body;
    if (!productId || typeof rating !== 'number' || rating < 1 || rating > 5) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const adminClient = createSupabaseAdminClient();

    // Verify the user has purchased this product in a confirmed order
    const { data: purchaseData, error: purchaseError } = await adminClient
        .from('orders')
        .select('id')
        .eq('buyer_id', user.id)
        .eq('status', 'confirmed')
        .limit(1);

    if (purchaseError || !purchaseData || purchaseData.length === 0) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    // More precise check: does any confirmed order contain this product?
    const { data: validPurchase, error: validError } = await adminClient
        .from('orders')
        .select('id, order_items!inner(product_variants!inner(product_id))')
        .eq('buyer_id', user.id)
        .eq('status', 'confirmed')
        .eq('order_items.product_variants.product_id', productId)
        .limit(1)
        .maybeSingle();

    if (validError || !validPurchase) {
        console.error('valid purchase check failed', validError);
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    // Check if review already exists
    const { data: existingReview } = await adminClient
        .from('reviews')
        .select('id')
        .eq('product_id', productId)
        .eq('profile_id', user.id)
        .limit(1)
        .maybeSingle();

    let result;
    if (existingReview?.id) {
        result = await adminClient
            .from('reviews')
            .update({
                rating,
                comment: comment ?? null,
            })
            .eq('id', existingReview.id)
            .select()
            .single();
    } else {
        result = await adminClient
            .from('reviews')
            .insert({
                product_id: productId,
                profile_id: user.id,
                rating,
                comment: comment ?? null,
            })
            .select()
            .single();
    }

    if (result.error) {
        console.error('review submit error', result.error);
        return jsonResponse({ error: strings.reviewSubmitError }, 500);
    }

    return jsonResponse({ success: true, review: result.data }, 200);
};
