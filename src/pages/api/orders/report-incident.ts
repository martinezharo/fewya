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

    let body: { orderId?: string; description?: string; photos?: string[] };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    const description = body.description;
    const photos = body.photos;

    if (!orderId || !description || !Array.isArray(photos)) {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    // Client-side validation is helpful but we enforce server-side too
    const nonSpaceLength = description.replace(/\s/g, '').length;
    if (nonSpaceLength < 50) {
        return jsonResponse({ error: t.incidentDescriptionError }, 400);
    }

    if (photos.length < 3) {
        return jsonResponse({ error: t.incidentMinPhotosError }, 400);
    }

    if (photos.length > 20) {
        return jsonResponse({ error: t.incidentMaxPhotosError }, 400);
    }

    try {
        // Convex verifies the caller is the order's buyer and that the order
        // is in a state where an incident can still be opened.
        const result = await convex.mutation(api.orders.reportIncidentForBuyer, {
            orderId,
            description,
            photos,
        });
        return jsonResponse(result, 200);
    } catch (error) {
        console.error('Convex report incident failed', error);
        return jsonResponse({ error: t.apiCheckoutConfirmationError }, 400);
    }
};
