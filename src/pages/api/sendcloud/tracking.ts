import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { getTrackingHistory } from '../../../lib/shipping/sendcloud';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { convexOnly } from '../../../lib/core/env';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ request, cookies }) => {
    const url = new URL(request.url);
    const shipmentId = url.searchParams.get('shipmentId');

    if (!shipmentId) {
        return jsonResponse({ error: 'shipmentId is required' }, 400);
    }

    try {
        const authClient = createSupabaseAuthClient(cookies, request);
        const { data: { user } } = await authClient.auth.getUser();

        if (!user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const convexToken = getRequestConvexToken(request);
        const convex = convexToken ? createConvexClient(convexToken) : null;
        if (convex) {
            try {
                const convexShipment = await convex.query(api.orders.getShipmentForAccess, { shipmentId });
                if (convexShipment) {
                    const events = await getTrackingHistory(shipmentId);
                    return jsonResponse({ events }, 200);
                }
            } catch (convexErr) {
                if (convexOnly) {
                    console.error('Convex tracking lookup failed:', convexErr);
                    return jsonResponse({ error: 'Failed to get tracking' }, 500);
                }
                console.warn('Convex tracking lookup skipped:', convexErr);
            }
        }

        if (convexOnly) return jsonResponse({ error: 'Shipment not found' }, 404);

        const { data: shipment } = await authClient
            .from('shipments')
            .select('id')
            .eq('sendcloud_shipment_id', shipmentId)
            .maybeSingle();

        if (!shipment) {
            return jsonResponse({ error: 'Shipment not found' }, 404);
        }

        const events = await getTrackingHistory(shipmentId);
        return jsonResponse({ events }, 200);
    } catch (err) {
        console.error('Sendcloud tracking error:', err);
        return jsonResponse({ error: 'Failed to get tracking' }, 500);
    }
};
