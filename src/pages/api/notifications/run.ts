import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';
import { runNotificationScan } from '../../../lib/notifications/scan';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Manual trigger for the notification scan (sub-status detection + reminders).
// The 4-hour cron runs this automatically; this endpoint is for testing/backfill.
export const POST: APIRoute = async ({ request }) => {
    const cronSecret = CRON_SECRET ?? '';
    const requestSecret = request.headers.get('X-Cron-Secret') ?? '';

    if (!cronSecret || !timingSafeEqual(requestSecret, cronSecret)) {
        securityLog('security.cron.unauthorized', { path: '/api/notifications/run' });
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const result = await runNotificationScan();
        return jsonResponse({ ...result }, 200);
    } catch (e) {
        console.error(JSON.stringify({ event: 'notifications_run.failed', error: e instanceof Error ? e.message : String(e) }));
        return jsonResponse({ error: 'Failed to run notification scan' }, 500);
    }
};
