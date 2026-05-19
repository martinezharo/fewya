import type { APIRoute } from 'astro';
import { downloadSendcloudLabelPdf } from '../../../lib/shipping/sendcloud';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { LABELS_BUCKET, uploadLabelPdf } from '../../../lib/shipping/labelStorage';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const LABELS_MARKER_PREFIX = `${LABELS_BUCKET}:`;

async function signAndRedirect(storagePath: string): Promise<Response> {
    const adminClient = createSupabaseAdminClient();
    const { data, error } = await adminClient.storage
        .from(LABELS_BUCKET)
        .createSignedUrl(storagePath, 60);

    if (error || !data?.signedUrl) {
        console.error('Label signed URL error:', error);
        return jsonResponse({ error: 'Failed to get label' }, 500);
    }

    return Response.redirect(data.signedUrl, 302);
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

        // RLS on `shipments` ensures buyer or seller of the parent order is allowed.
        const { data: shipment } = await authClient
            .from('shipments')
            .select('id, label_url, orders!inner(public_id)')
            .eq('sendcloud_shipment_id', shipmentId)
            .maybeSingle();

        if (!shipment) {
            return jsonResponse({ error: 'Shipment not found' }, 404);
        }

        if (shipment.label_url?.startsWith(LABELS_MARKER_PREFIX)) {
            const path = shipment.label_url.slice(LABELS_MARKER_PREFIX.length);
            return signAndRedirect(path);
        }

        // Legacy or failed-upload path: label_url is the raw Sendcloud document URL,
        // which requires Basic auth to fetch. Migrate it to Storage now so future
        // clicks are instant.
        if (!shipment.label_url) {
            return jsonResponse({ error: 'Label not found' }, 404);
        }

        const orderRel = shipment.orders as { public_id?: string } | { public_id?: string }[] | null;
        const publicId = Array.isArray(orderRel) ? orderRel[0]?.public_id : orderRel?.public_id;
        if (!publicId) {
            console.error('Label migration: order public_id missing for shipment', shipment.id);
            return jsonResponse({ error: 'Failed to get label' }, 500);
        }

        try {
            const pdfBytes = await downloadSendcloudLabelPdf(shipment.label_url);
            const newMarker = await uploadLabelPdf(publicId, pdfBytes);

            const adminClient = createSupabaseAdminClient();
            const { error: updateError } = await adminClient
                .from('shipments')
                .update({ label_url: newMarker })
                .eq('id', shipment.id);
            if (updateError) {
                console.error('Label migration: failed to update shipments.label_url', updateError);
            }

            return signAndRedirect(newMarker.slice(LABELS_MARKER_PREFIX.length));
        } catch (migrationErr) {
            console.error('Label migration failed:', migrationErr);
            return jsonResponse({ error: 'No se pudo descargar la etiqueta de Sendcloud' }, 500);
        }
    } catch (err) {
        console.error('Sendcloud label error:', err);
        return jsonResponse({ error: 'Failed to get label' }, 500);
    }
};
