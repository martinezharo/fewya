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
    if (!convex) return jsonResponse({ error: t.apiUnauthorized }, 401);

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const { orderId } = body;
    if (!orderId) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    try {
        // Convex checks both that the caller is the buyer and that the order
        // is still pending; hiding a paid order is not allowed.
        const result = await convex.mutation(api.orders.hideForCurrentBuyer, { orderId });
        return jsonResponse(result, 200);
    } catch (error) {
        console.error('Convex hide order failed', error);
        return jsonResponse({ error: t.orderHideNotAllowed }, 400);
    }
};
