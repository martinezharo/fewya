import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';

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

export const POST: APIRoute = async ({ request }) => {
    const convex = createRequestConvexClient(request);

    if (!convex) {
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

    try {
        await convex.mutation(api.notifications.subscribe, {
            endpoint,
            p256dh,
            auth,
            userAgent: request.headers.get('user-agent') ?? undefined,
        });
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error(JSON.stringify({ event: 'push_subscribe.failed', error: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: 'Could not save subscription' }, 500);
    }
};
