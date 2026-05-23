import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { getShipment } from '../../../lib/shipping/sendcloud';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';
import { SHIPMENT_STATUS } from '../../../lib/shipping/shipmentStatus';

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

    const supabase = createSupabaseAdminClient();

    const { data: shipments, error } = await supabase
        .from('shipments')
        .select('id, sendcloud_shipment_id, status')
        .not('sendcloud_shipment_id', 'is', null)
        .not('status', 'in', `(${[SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.FAILED, SHIPMENT_STATUS.CANCELLED].map((s) => `"${s}"`).join(',')})`);

    if (error) {
        console.error(JSON.stringify({ event: 'sync_tracking.fetch_error', error: error.message }));
        return jsonResponse({ error: 'Failed to fetch shipments' }, 500);
    }

    if (!shipments?.length) {
        return jsonResponse({ synced: 0, errors: 0 }, 200);
    }

    const results = await Promise.allSettled(
        shipments.map(async (shipment) => {
            const { status, trackingNumber, trackingUrl } = await getShipment(shipment.sendcloud_shipment_id!);

            const { error: rpcError } = await supabase.rpc('update_shipment_tracking', {
                p_shipment_id: shipment.id,
                p_status: status,
                p_description: `Sendcloud status: ${status}`,
                p_location: '',
                p_event_timestamp: new Date().toISOString(),
                p_tracking_number: trackingNumber,
                p_tracking_url: trackingUrl,
                p_raw_data: { status, trackingNumber, trackingUrl, polled: true },
            });

            if (rpcError) throw new Error(rpcError.message);
        })
    );

    const errors = results.filter(r => r.status === 'rejected').length;
    const synced = results.length - errors;

    if (errors > 0) {
        console.error(JSON.stringify({ event: 'sync_tracking.partial_errors', total: results.length, errors }));
    }

    return jsonResponse({ synced, errors }, 200);
};
