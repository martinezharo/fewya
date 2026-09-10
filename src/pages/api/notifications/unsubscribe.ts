import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    const convex = createRequestConvexClient(request);

    if (!convex) {
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

    try {
        await convex.mutation(api.notifications.unsubscribe, { endpoint });
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error(JSON.stringify({ event: 'push_unsubscribe.failed', error: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: 'Could not remove subscription' }, 500);
    }
};
