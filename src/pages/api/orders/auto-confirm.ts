import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';
import { runAutoConfirm } from '../../../lib/orders/autoConfirm';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    // M6: cron-only endpoint — authenticate with X-Cron-Secret header (timing-safe)
    const cronSecret = CRON_SECRET ?? '';
    const requestSecret = request.headers.get('X-Cron-Secret') ?? '';

    if (!cronSecret || !timingSafeEqual(requestSecret, cronSecret)) {
        securityLog('security.cron.unauthorized', { path: '/api/orders/auto-confirm' });
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const result = await runAutoConfirm();
        return jsonResponse({ success: true, ...result }, 200);
    } catch {
        return jsonResponse({ error: 'Failed to auto-confirm orders' }, 500);
    }
};
