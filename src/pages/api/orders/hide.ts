import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

import { ORDER_STATUS } from '../../../lib/orders/orderStatus';
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
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

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

    if (orderId.startsWith('convex:')) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return jsonResponse({ error: t.apiUnauthorized }, 401);
        try {
            const result = await convex.mutation(api.orders.hideForCurrentBuyer, { orderId });
            return jsonResponse(result, 200);
        } catch (error) {
            console.error('Convex hide order failed', error);
            return jsonResponse({ error: t.orderHideNotAllowed }, 400);
        }
    }

    if (convexOnly) return jsonResponse({ error: t.orderHideNotAllowed }, 404);

    const admin = createSupabaseAdminClient();

    const { data: order } = await admin
        .from('orders')
        .select('id, status, buyer_id')
        .eq('id', orderId)
        .eq('buyer_id', user.id)
        .single();

    if (!order) {
        return jsonResponse({ error: t.apiUnauthorized }, 403);
    }

    if (order.status !== ORDER_STATUS.PENDING) {
        return jsonResponse({ error: t.orderHideNotAllowed }, 400);
    }

    const { error } = await admin
        .from('orders')
        .update({ buyer_hidden_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('buyer_id', user.id)
        .eq('status', ORDER_STATUS.PENDING);

    if (error) {
        console.error('hide order failed', error);
        return jsonResponse({ error: t.orderHideError }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
