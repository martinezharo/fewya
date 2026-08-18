import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { downloadSendcloudLabelPdf } from '../../../lib/shipping/sendcloud';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { LABELS_BUCKET, uploadLabelPdf } from '../../../lib/shipping/labelStorage';
import { convexOnly } from '../../../lib/core/env';
import type { Id } from '../../../../convex/_generated/dataModel';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const LABELS_MARKER_PREFIX = `${LABELS_BUCKET}:`;
const CONVEX_STORAGE_MARKER_PREFIX = 'convex-storage:';

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

async function redirectConvexStorage(
    convex: NonNullable<ReturnType<typeof createConvexClient>>,
    marker: string,
): Promise<Response> {
    const storageId = marker.slice(CONVEX_STORAGE_MARKER_PREFIX.length) as Id<'_storage'>;
    const url = await convex.query(api.storage.getUrl, { storageId });
    if (!url) return jsonResponse({ error: 'Label not found' }, 404);
    return Response.redirect(url, 302);
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

        // Post-cutover shipments are authorized by Convex. The label bytes are
        // still served from the existing private Storage bucket until the
        // storage-object migration is complete.
        const convexToken = getRequestConvexToken(request);
        const convex = convexToken ? createConvexClient(convexToken) : null;
        if (convex) {
            try {
                const convexShipment = await convex.query(api.orders.getShipmentForAccess, { shipmentId });
                if (convexShipment) {
                    if (convexShipment.labelUrl?.startsWith(CONVEX_STORAGE_MARKER_PREFIX)) {
                        return redirectConvexStorage(convex, convexShipment.labelUrl);
                    }
                    if (convexShipment.labelUrl) {
                        const migratedUrl = await convex.query(api.storage.resolveLegacyUrl, { url: convexShipment.labelUrl });
                        if (migratedUrl) return Response.redirect(migratedUrl, 302);
                    }
                    if (convexShipment.labelUrl?.startsWith(LABELS_MARKER_PREFIX)) {
                        if (convexOnly) return jsonResponse({ error: 'Label not found' }, 404);
                        return signAndRedirect(convexShipment.labelUrl.slice(LABELS_MARKER_PREFIX.length));
                    }
                    if (!convexShipment.labelUrl) return jsonResponse({ error: 'Label not found' }, 404);

                    try {
                        const pdfBytes = await downloadSendcloudLabelPdf(convexShipment.labelUrl);
                        const newMarker = await uploadLabelPdf(convexShipment.publicId, pdfBytes, request);
                        await convex.mutation(api.orders.updateShipmentLabelUrl, {
                            shipmentId,
                            labelUrl: newMarker,
                        });
                        return newMarker.startsWith(CONVEX_STORAGE_MARKER_PREFIX)
                            ? redirectConvexStorage(convex, newMarker)
                            : signAndRedirect(newMarker.slice(LABELS_MARKER_PREFIX.length));
                    } catch (migrationErr) {
                        console.error('Convex label migration failed:', migrationErr);
                        return jsonResponse({ error: 'No se pudo descargar la etiqueta de Sendcloud' }, 500);
                    }
                }
            } catch (convexErr) {
                // A non-Convex shipment (historical Supabase order) continues
                // through the compatibility query below.
                console.warn('Convex label lookup skipped:', convexErr);
            }
        }

        if (convexOnly) {
            return jsonResponse({ error: 'Shipment not found' }, 404);
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
