import type { APIRoute } from 'astro';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    // Verify webhook secret
    const webhookSecret = process.env.SENDCLOUD_WEBHOOK_SECRET || '';
    const requestSecret = request.headers.get('X-Webhook-Secret') || '';
    if (webhookSecret && requestSecret !== webhookSecret) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body: {
        action?: string;
        parcel?: {
            id?: number;
            tracking_number?: string;
            tracking_url?: string;
            status?: {
                message?: string;
                id?: number;
            };
            order_number?: string;
        };
        timestamp?: number;
    };

    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const { action, parcel, timestamp } = body;

    if (!parcel?.id) {
        return jsonResponse({ error: 'parcel.id is required' }, 400);
    }

    const { createClient } = await import('@supabase/supabase-js');
    const { SUPABASE_URL, SUPABASE_KEY } = await import('astro:env/server');
    const supabase = createClient(SUPABASE_URL as string, SUPABASE_KEY as string);

    // Find shipment by sendcloud_shipment_id (parcel id)
    const { data: shipmentRow } = await supabase
        .from('shipments')
        .select('id, order_id')
        .eq('sendcloud_shipment_id', String(parcel.id))
        .single();

    if (!shipmentRow) {
        return jsonResponse({ error: 'Shipment not found' }, 404);
    }

    const shipment = shipmentRow as any;
    const normalizedStatus = action || parcel.status?.message || 'unknown';
    const description = `Sendcloud status: ${normalizedStatus}`;
    const location = '';
    const eventTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();

    try {
        const { error } = await supabase.rpc('update_shipment_tracking', {
            p_shipment_id: shipment.id,
            p_status: normalizedStatus,
            p_description: description,
            p_location: location,
            p_event_timestamp: eventTimestamp.toISOString(),
            p_tracking_number: parcel.tracking_number,
            p_tracking_url: parcel.tracking_url,
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
