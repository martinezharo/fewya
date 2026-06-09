import type { APIRoute } from 'astro';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

interface SubscribeBody {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
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

    let body: SubscribeBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
        return jsonResponse({ error: 'Invalid subscription' }, 400);
    }

    // Upsert by endpoint (re-subscribing the same device must not duplicate, and
    // an endpoint that moved to another account is reassigned to this user).
    const admin = createSupabaseAdminClient();
    const { error } = await admin
        .from('push_subscriptions')
        .upsert(
            {
                user_id: user.id,
                endpoint,
                p256dh,
                auth,
                user_agent: request.headers.get('user-agent') ?? null,
            },
            { onConflict: 'endpoint' },
        );

    if (error) {
        console.error(JSON.stringify({ event: 'push_subscribe.failed', error: error.message }));
        return jsonResponse({ error: 'Could not save subscription' }, 500);
    }

    return jsonResponse({ success: true }, 200);
};
