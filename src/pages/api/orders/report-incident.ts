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

    let body: { orderId?: string; description?: string; photos?: string[] };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    const description = body.description;
    const photos = body.photos;

    if (!orderId || !description || !Array.isArray(photos)) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    // Client-side validation is helpful but we enforce server-side too
    const nonSpaceLength = description.replace(/\s/g, '').length;
    if (nonSpaceLength < 50) {
        return jsonResponse({ error: 'La explicación es insuficiente, debes dar más detalles' }, 400);
    }

    if (photos.length < 3) {
        return jsonResponse({ error: 'Debes subir al menos 3 imágenes' }, 400);
    }

    if (photos.length > 20) {
        return jsonResponse({ error: 'Máximo 20 imágenes permitidas' }, 400);
    }

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
