import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';
import { optionalText, requiredText } from '../../../../lib/core/requestFields';

/** Matches the `maxlength` on the reply textarea; an unbounded field is a way
 * for one seller to fill the deployment. An empty reply clears an existing one. */
const REPLY_MAX = 2000;
const REVIEW_ID_MAX = 128;

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

    let reviewId: string;
    let reply: string;
    try {
        const body = await request.json();
        if (typeof body !== 'object' || body === null) throw new Error('not an object');
        const raw = body as Record<string, unknown>;
        reviewId = requiredText('reviewId', raw.reviewId, REVIEW_ID_MAX);
        if (typeof raw.reply !== 'string') throw new Error('reply must be a string');
        reply = optionalText('reply', raw.reply, REPLY_MAX) ?? '';
    } catch {
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
