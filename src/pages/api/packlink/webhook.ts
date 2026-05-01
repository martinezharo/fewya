import type { APIRoute } from 'astro';
import { getTrackingHistory } from '../../../lib/packlink';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    let body: {
        shipment_id?: string;
        reference?: string;
        event?: string;
        status?: string;
        tracking_number?: string;
        tracking_url?: string;
        timestamp?: number;
    };

    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const { shipment_id, reference, event, status: webhookStatus, tracking_number, tracking_url, timestamp } = body;

    if (!shipment_id && !reference) {
        return jsonResponse({ error: 'shipment_id or reference required' }, 400);
    }

    const { createClient } = await import('@supabase/supabase-js');
    const { SUPABASE_URL, SUPABASE_KEY } = await import('astro:env/server');
    const supabase = createClient(SUPABASE_URL as string, SUPABASE_KEY as string);

    let packlinkShipmentId = shipment_id;

    if (!packlinkShipmentId && reference) {
        const { data: shipment } = await supabase
            .from('shipments')
            .select('id, packlink_shipment_id')
            .eq('packlink_reference', reference)
            .single();

        if (shipment) {
            packlinkShipmentId = (shipment as any).packlink_shipment_id;
        }
    }

    if (!packlinkShipmentId) {
        return jsonResponse({ error: 'Shipment not found' }, 404);
    }

    const normalizedStatus = event || webhookStatus || 'unknown';
    const description = `Packlink status: ${normalizedStatus}`;
    const location = '';
    const eventTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();

    try {
        const { data: updatedShipment, error } = await supabase.rpc('update_shipment_tracking', {
            p_shipment_id: packlinkShipmentId,
            p_status: normalizedStatus,
            p_description: description,
            p_location: location,
            p_event_timestamp: eventTimestamp.toISOString(),
            p_tracking_number: tracking_number,
            p_tracking_url: tracking_url,
            p_raw_data: body as Record<string, unknown>,
        });

        if (error) {
            console.error('Failed to update shipment tracking:', error);
            return jsonResponse({ error: 'Failed to update tracking' }, 500);
        }

        return jsonResponse({ success: true }, 200);
    } catch (err) {
        console.error('Webhook error:', err);
        return jsonResponse({ error: 'Internal error' }, 500);
    }
};
