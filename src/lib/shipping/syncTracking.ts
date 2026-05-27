import { createSupabaseAdminClient } from '../core/supabase-admin';
import { getShipment } from './sendcloud';
import { SHIPMENT_STATUS } from './shipmentStatus';

/**
 * Polls Sendcloud for every non-terminal shipment and pushes the latest status
 * through update_shipment_tracking (which advances the order's state machine).
 *
 * Shared by the cron `scheduled()` handler and the HTTP endpoint. Reads env via
 * astro:env at call time, so it is safe to invoke from the scheduled context.
 */
export async function syncAllTracking(): Promise<{ synced: number; errors: number }> {
    const supabase = createSupabaseAdminClient();

    const { data: shipments, error } = await supabase
        .from('shipments')
        .select('id, sendcloud_shipment_id, status')
        .not('sendcloud_shipment_id', 'is', null)
        .not('status', 'in', `(${[SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.FAILED, SHIPMENT_STATUS.CANCELLED].map((s) => `"${s}"`).join(',')})`);

    if (error) {
        console.error(JSON.stringify({ event: 'sync_tracking.fetch_error', error: error.message }));
        throw new Error(error.message);
    }

    if (!shipments?.length) {
        return { synced: 0, errors: 0 };
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

    return { synced, errors };
}
