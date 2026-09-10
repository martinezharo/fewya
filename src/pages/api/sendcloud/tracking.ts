import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { getTrackingHistory } from '../../../lib/shipping/sendcloud';
import { createRequestConvexClient } from '../../../lib/core/auth';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const shipmentId = url.searchParams.get('shipmentId');

    if (!shipmentId) {
        return jsonResponse({ error: 'shipmentId is required' }, 400);
    }

    // Access is authorized by Convex: the query only answers for the buyer or
    // the seller of the shipment's order.
    const convex = createRequestConvexClient(request);
    if (!convex) return jsonResponse({ error: 'Unauthorized' }, 401);

    try {
        const shipment = await convex.query(api.orders.getShipmentForAccess, { shipmentId });
        if (!shipment) return jsonResponse({ error: 'Shipment not found' }, 404);

        const events = await getTrackingHistory(shipmentId);
        return jsonResponse({ events }, 200);
    } catch (err) {
        console.error('Sendcloud tracking error:', err);
        return jsonResponse({ error: 'Failed to get tracking' }, 500);
    }
};
