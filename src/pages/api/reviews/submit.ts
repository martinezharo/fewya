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

    let body: { productId?: string; rating?: number; comment?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const { productId, rating, comment } = body;
    if (!productId || typeof rating !== 'number' || rating < 1 || rating > 5) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    // A4: limit comment length to prevent storage abuse
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 2000)) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    try {
        // Convex verifies the caller bought the product in a confirmed order.
        await convex.mutation(api.reviews.submitBatch, {
            reviews: [{ productId, rating, ...(comment?.trim() ? { comment: comment.trim() } : {}) }],
        });
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'reviews.submit_failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return jsonResponse({ error: t.apiForbidden }, 403);
    }
};
