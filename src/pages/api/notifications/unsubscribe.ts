import type { APIRoute } from 'astro';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

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
