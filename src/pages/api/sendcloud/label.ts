import type { APIRoute } from 'astro';
import { getShipmentLabel } from '../../../lib/shipping/sendcloud';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

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

        // Verify the user can access this shipment via DB RLS (already checks buyer/seller).
        const { data: shipment } = await authClient
            .from('shipments')
            .select('id, label_url')
            .eq('sendcloud_shipment_id', shipmentId)
            .maybeSingle();

        if (!shipment) {
            return jsonResponse({ error: 'Shipment not found' }, 404);
        }

        if (shipment.label_url?.startsWith('labels:')) {
            const path = shipment.label_url.slice('labels:'.length);
            // Use admin client to create the signed URL so we bypass any
            // storage-object RLS quirks; DB access was already authorised above.
            const adminClient = createSupabaseAdminClient();
            const { data, error } = await adminClient.storage
                .from('labels')
                .createSignedUrl(path, 60);

            if (error) {
                console.error('Label signed URL error:', error);
                return jsonResponse({ error: 'Failed to get label' }, 500);
            }

            if (!data?.signedUrl) {
                return jsonResponse({ error: 'Failed to get label' }, 500);
            }

            return Response.redirect(data.signedUrl, 302);
        }

        const labelUrl = shipment.label_url || await getShipmentLabel(shipmentId);
        if (!labelUrl) {
            return jsonResponse({ error: 'Label not found' }, 404);
        }

        return Response.redirect(labelUrl, 302);
    } catch (err) {
        console.error('Sendcloud label error:', err);
        return jsonResponse({ error: 'Failed to get label' }, 500);
    }
};
