import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { convexOnly } from '../../../lib/core/env';

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

    if (orderId.startsWith('convex:')) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return jsonResponse({ error: t.apiUnauthorized }, 401);
        try {
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
    }

    if (convexOnly) return jsonResponse({ error: 'Order not found' }, 404);

    const adminClient = createSupabaseAdminClient();
    const { data: updatedOrder, error } = await adminClient.rpc(
        'report_order_incident',
        { p_actor_id: user.id, p_order_id: orderId, p_description: description, p_photos: photos }
    );

    if (error) {
        console.error('report_order_incident failed', error);
        return jsonResponse({ error: error.message || 'No se pudo reportar la incidencia' }, 400);
    }

    const order = Array.isArray(updatedOrder) ? updatedOrder[0] : updatedOrder;

    return jsonResponse({
        success: true,
        orderId: order?.id ?? orderId,
        publicId: order?.public_id ?? null,
    }, 200);
};
