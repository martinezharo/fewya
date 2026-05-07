import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
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

    let body: { orderId?: string; reason?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const orderId = body.orderId;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const { data: updatedOrder, error } = await authClient.rpc(
        'report_order_incident',
        { p_order_id: orderId }
    );

    if (error) {
        console.error('report_order_incident failed', error);
        return jsonResponse({ error: 'No se pudo reportar la incidencia' }, 400);
    }

    const order = Array.isArray(updatedOrder) ? updatedOrder[0] : updatedOrder;

    return jsonResponse({
        success: true,
        orderId: order?.id ?? orderId,
        publicId: order?.public_id ?? null,
    }, 200);
};
