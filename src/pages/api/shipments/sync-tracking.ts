import type { APIRoute } from 'astro';
import { CRON_SECRET, CONVEX_WEBHOOK_SECRET } from 'astro:env/server';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';
import { syncAllTracking } from '../../../lib/shipping/syncTracking';
import { convexOnly } from '../../../lib/core/env';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    const cronSecret = CRON_SECRET ?? '';
    const requestSecret = request.headers.get('X-Cron-Secret') ?? '';

    if (!cronSecret || !timingSafeEqual(requestSecret, cronSecret)) {
        securityLog('security.cron.unauthorized', { path: '/api/shipments/sync-tracking' });
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const result = await syncAllTracking(convexOnly ? CONVEX_WEBHOOK_SECRET : undefined);
        return jsonResponse(result, 200);
    } catch {
        return jsonResponse({ error: 'Failed to sync tracking' }, 500);
    }
};
