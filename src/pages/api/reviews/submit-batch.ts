import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

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

    let body: { reviews?: { productId: string; rating: number; comment?: string }[] };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const reviews = body.reviews;
    if (!Array.isArray(reviews) || reviews.length === 0) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    for (const r of reviews) {
        if (!r.productId || typeof r.rating !== 'number' || r.rating < 1 || r.rating > 5) {
            return jsonResponse({ error: t.apiInvalidBody }, 400);
        }
        // A4: limit comment length
        if (r.comment !== undefined && (typeof r.comment !== 'string' || r.comment.length > 2000)) {
            return jsonResponse({ error: t.apiInvalidBody }, 400);
        }
    }

    const adminClient = createSupabaseAdminClient();

    // Verify purchase for each product in a single query
    const productIds = [...new Set(reviews.map((r) => r.productId))];

    const { data: validPurchases, error: validError } = await adminClient
        .from('orders')
        .select('id, order_items!inner(product_variants!inner(product_id))')
        .eq('buyer_id', user.id)
        .eq('status', ORDER_STATUS.CONFIRMED)
        .in('order_items.product_variants.product_id', productIds);

    if (validError) {
        console.error('valid purchase check failed', validError);
        return jsonResponse({ error: t.apiForbidden }, 403);
    }

    const purchasedProductIds = new Set<string>();
    (validPurchases ?? []).forEach((order: any) => {
        const items = order.order_items ?? [];
        items.forEach((oi: any) => {
            const variant = Array.isArray(oi.product_variants) ? oi.product_variants[0] : oi.product_variants;
            if (variant?.product_id) purchasedProductIds.add(variant.product_id);
        });
    });

    for (const r of reviews) {
        if (!purchasedProductIds.has(r.productId)) {
            return jsonResponse({ error: t.apiForbidden }, 403);
        }
    }

    // Fetch existing reviews for upsert
    const { data: existingReviews } = await adminClient
        .from('reviews')
        .select('id, product_id')
        .eq('profile_id', user.id)
        .in('product_id', productIds);

    const existingMap = new Map<string, string>();
    (existingReviews ?? []).forEach((er: any) => {
        existingMap.set(er.product_id, er.id);
    });

    const toInsert: { product_id: string; profile_id: string; rating: number; comment: string | null }[] = [];
    const toUpdate: { id: string; rating: number; comment: string | null }[] = [];

    for (const r of reviews) {
        const comment = r.comment?.trim() ?? null;
        if (existingMap.has(r.productId)) {
            toUpdate.push({ id: existingMap.get(r.productId)!, rating: r.rating, comment });
        } else {
            toInsert.push({ product_id: r.productId, profile_id: user.id, rating: r.rating, comment });
        }
    }

    if (toInsert.length > 0) {
        // Remove auto-reviews for products being reviewed for the first time
        await adminClient
            .from('reviews')
            .delete()
            .in('product_id', toInsert.map((r) => r.product_id))
            .eq('is_auto', true);
        const { error: insertError } = await adminClient.from('reviews').insert(toInsert);
        if (insertError) {
            console.error('review batch insert error', insertError);
            return jsonResponse({ error: t.reviewSubmitError }, 500);
        }
    }

    for (const upd of toUpdate) {
        const { error: updateError } = await adminClient
            .from('reviews')
            .update({ rating: upd.rating, comment: upd.comment })
            .eq('id', upd.id);
        if (updateError) {
            console.error('review batch update error', updateError);
            return jsonResponse({ error: t.reviewSubmitError }, 500);
        }
    }

    return jsonResponse({ success: true }, 200);
};
