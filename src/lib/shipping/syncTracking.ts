import { createSupabaseAdminClient } from '../core/supabase-admin';
import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { getShipment } from './sendcloud';
import { SHIPMENT_STATUS } from './shipmentStatus';
import { convexOnly } from '../core/env';

// Max number of Sendcloud requests allowed in flight at once. Keeps outbound API
// call volume bounded as shipment counts grow, instead of firing one request per
// open shipment fully in parallel.
const SYNC_CONCURRENCY_LIMIT = 5;

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at a time, by
 * chunking `items` into sequential batches. Mirrors `Promise.allSettled` — each
 * item's outcome (fulfilled/rejected) is preserved independently, so one
 * shipment failing doesn't affect the others.
 */
async function mapWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        results.push(...await Promise.allSettled(batch.map(fn)));
    }
    return results;
}

/**
 * Polls Sendcloud for every non-terminal shipment and pushes the latest status
 * through update_shipment_tracking (which advances the order's state machine).
 *
 * Shared by the cron `scheduled()` handler and the HTTP endpoint. Reads env via
 * astro:env at call time, so it is safe to invoke from the scheduled context.
 */
export async function syncAllTracking(convexSecret?: string): Promise<{ synced: number; errors: number }> {
    let convexSynced = 0;
    let convexErrors = 0;
    const convex = convexSecret ? createConvexClient() : null;

    if (convex && convexSecret) {
        try {
            const candidates = await convex.query(api.orders.listTrackingCandidates, { secret: convexSecret });
            const convexResults = await mapWithConcurrencyLimit(candidates, SYNC_CONCURRENCY_LIMIT, async (shipment) => {
                const { status, trackingNumber, trackingUrl } = await getShipment(shipment.sendcloudShipmentId);
                await convex.mutation(api.orders.applyShipmentTracking, {
                    secret: convexSecret,
                    shipmentLegacyId: shipment.id,
                    status,
                    description: `Sendcloud status: ${status}`,
                    location: '',
                    eventTimestamp: Date.now(),
                    ...(trackingNumber ? { trackingNumber } : {}),
                    ...(trackingUrl ? { trackingUrl } : {}),
                    rawData: { status, trackingNumber, trackingUrl, polled: true },
                });
            });
            convexErrors = convexResults.filter((result) => result.status === 'rejected').length;
            convexSynced = convexResults.length - convexErrors;
            if (convexErrors > 0) {
                console.error(JSON.stringify({ event: 'sync_tracking.convex_partial_errors', total: convexResults.length, errors: convexErrors }));
            }
        } catch (error) {
            convexErrors = 1;
            console.error(JSON.stringify({
                event: 'sync_tracking.convex_fetch_error',
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    if (convexOnly) return { synced: convexSynced, errors: convexErrors };

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
        return { synced: convexSynced, errors: convexErrors };
    }

    const results = await mapWithConcurrencyLimit(shipments, SYNC_CONCURRENCY_LIMIT, async (shipment) => {
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
    });

    const errors = results.filter(r => r.status === 'rejected').length;
    const synced = results.length - errors;

    if (errors > 0) {
        console.error(JSON.stringify({ event: 'sync_tracking.partial_errors', total: results.length, errors }));
    }

    return { synced: convexSynced + synced, errors: convexErrors + errors };
}
