import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { orderId?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const { orderId } = body;
    if (!orderId) {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const admin = createSupabaseAdminClient();

    const { data: order } = await admin
        .from('orders')
        .select('id, status, buyer_id')
        .eq('id', orderId)
        .eq('buyer_id', user.id)
        .single();

    if (!order) {
        return jsonResponse({ error: strings.apiUnauthorized }, 403);
    }

    if (order.status !== ORDER_STATUS.PENDING) {
        return jsonResponse({ error: strings.orderHideNotAllowed }, 400);
    }

    const { error } = await admin
        .from('orders')
        .update({ buyer_hidden_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('buyer_id', user.id)
        .eq('status', ORDER_STATUS.PENDING);

    if (error) {
        console.error('hide order failed', error);
        return jsonResponse({ error: strings.orderHideError }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
