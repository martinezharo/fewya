import type { APIRoute } from 'astro';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { convexOnly } from '../../../lib/core/env';
import { api } from '../../../../convex/_generated/api';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const { createSupabaseAuthClient } = await import('../../../lib/core/auth');
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let endpoint: string | undefined;
    try {
        const body = (await request.json()) as { endpoint?: string };
        endpoint = body?.endpoint;
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }
    if (!endpoint) {
        return jsonResponse({ error: 'Missing endpoint' }, 400);
    }

    if (convexOnly) {
        const token = getRequestConvexToken(request);
        const convex = token ? createConvexClient(token) : null;
        if (!convex) return jsonResponse({ error: 'Unauthorized' }, 401);
        try {
            await convex.mutation(api.notifications.unsubscribe, { endpoint });
            return jsonResponse({ success: true }, 200);
        } catch (error) {
            console.error(JSON.stringify({ event: 'push_unsubscribe.convex_failed', error: error instanceof Error ? error.message : String(error) }));
            return jsonResponse({ error: 'Could not remove subscription' }, 500);
        }
    }

    const admin = createSupabaseAdminClient();
    // Scope the delete to the caller's own subscriptions.
    const { error } = await admin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
        .eq('user_id', user.id);

    if (error) {
        return jsonResponse({ error: 'Could not remove subscription' }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
