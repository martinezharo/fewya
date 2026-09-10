import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

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

    try {
        await convex.mutation(api.seller.replyReview, { reviewId, reply });
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_review_reply.failed', error: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: t.sellerReviewsReplyError }, 500);
    }
};
