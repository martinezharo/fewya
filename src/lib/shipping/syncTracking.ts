import { createConvexClient } from '../core/convex';
import { api } from '../../../convex/_generated/api';
import { getShipment } from './sendcloud';

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
 * into Convex (which advances the order's state machine).
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
                console.error(JSON.stringify({ event: 'sync_tracking.partial_errors', total: convexResults.length, errors: convexErrors }));
            }
        } catch (error) {
            convexErrors = 1;
            console.error(JSON.stringify({
                event: 'sync_tracking.fetch_error',
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    return { synced: convexSynced, errors: convexErrors };
}
