import type { APIRoute } from 'astro';
import { getTrackingHistory } from '../../../lib/sendcloud';

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

    try {
        const events = await getTrackingHistory(shipmentId);
        return jsonResponse({ events }, 200);
    } catch (err) {
        console.error('Sendcloud tracking error:', err);
        return jsonResponse({ error: 'Failed to get tracking' }, 500);
    }
};
