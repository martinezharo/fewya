import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
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

    try {
        // Convex verifies every product was bought by the caller in a
        // confirmed order before writing any of them.
        await convex.mutation(api.reviews.submitBatch, {
            reviews: reviews.map((review) => ({
                productId: review.productId,
                rating: review.rating,
                comment: review.comment?.trim() || undefined,
            })),
        });
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'reviews.submit_batch_failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return jsonResponse({ error: t.apiForbidden }, 403);
    }
};
