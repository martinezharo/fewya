import type { APIRoute } from 'astro';
import { SENDCLOUD_WEBHOOK_SECRET } from 'astro:env/server';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { timingSafeEqual } from '../../../lib/core/timing-safe';
import { securityLog } from '../../../lib/core/security-log';

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request }) => {
    const webhookSecret = SENDCLOUD_WEBHOOK_SECRET ?? '';
    const requestSecret = request.headers.get('X-Webhook-Secret') ?? '';

    // A2: timing-safe comparison to prevent secret enumeration via timing
    if (!webhookSecret || !timingSafeEqual(requestSecret, webhookSecret)) {
        securityLog('security.webhook.invalid_signature', { source: 'sendcloud' });
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

    // A2: reject stale events to mitigate replay attacks with a leaked secret
    if (timestamp !== undefined) {
        const drift = Math.abs(Date.now() - timestamp * 1000);
        if (drift > MAX_TIMESTAMP_DRIFT_MS) {
            securityLog('security.webhook.stale_timestamp', { source: 'sendcloud', timestamp, drift });
            return jsonResponse({ error: 'Stale event' }, 400);
        }
    }

    if (!parcel?.id) {
        return jsonResponse({ error: 'parcel.id is required' }, 400);
    }

    const supabase = createSupabaseAdminClient();

    // M2: idempotency — skip already-processed events
    const eventId = `sendcloud:${parcel.id}:${action ?? ''}:${timestamp ?? ''}`;
    const { error: insertConflict } = await supabase
        .from('processed_webhook_events')
        .insert({ event_id: eventId, source: 'sendcloud' });

    if (insertConflict) {
        return jsonResponse({ received: true }, 200);
    }

    // Find shipment by sendcloud_shipment_id
    const { data: shipmentRow } = await supabase
        .from('shipments')
        .select('id, order_id')
        .eq('sendcloud_shipment_id', String(parcel.id))
        .single();

    if (!shipmentRow) {
        return jsonResponse({ error: 'Shipment not found' }, 404);
    }

    const shipment = shipmentRow as { id: string; order_id: string };
    const normalizedStatus = action || parcel.status?.message || 'unknown';
    const description = `Sendcloud status: ${normalizedStatus}`;
    const eventTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();

    try {
        const { error } = await supabase.rpc('update_shipment_tracking', {
            p_shipment_id: shipment.id,
            p_status: normalizedStatus,
            p_description: description,
            p_location: '',
            p_event_timestamp: eventTimestamp.toISOString(),
            p_tracking_number: parcel.tracking_number,
            p_tracking_url: parcel.tracking_url,
            p_raw_data: body as Record<string, unknown>,
        });

        if (error) {
            // M3: do not expose internal error to webhook caller
            console.error(JSON.stringify({ event: 'sendcloud_webhook.tracking_update_failed', error: error.message }));
            return jsonResponse({ error: 'Failed to update tracking' }, 500);
        }

        return jsonResponse({ success: true }, 200);
    } catch (err) {
        console.error(JSON.stringify({ event: 'sendcloud_webhook.unexpected_error', error: err instanceof Error ? err.message : String(err) }));
        return jsonResponse({ error: 'Internal error' }, 500);
    }
};
