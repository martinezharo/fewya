import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { downloadSendcloudLabelPdf } from '../../../lib/shipping/sendcloud';
import { createRequestConvexClient } from '../../../lib/core/auth';
import type { createConvexClient } from '../../../lib/core/convex';
import { uploadLabelPdf } from '../../../lib/shipping/labelStorage';
import type { Id } from '../../../../convex/_generated/dataModel';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const CONVEX_STORAGE_MARKER_PREFIX = 'convex-storage:';

async function redirectConvexStorage(
    convex: NonNullable<ReturnType<typeof createConvexClient>>,
    marker: string,
): Promise<Response> {
    const storageId = marker.slice(CONVEX_STORAGE_MARKER_PREFIX.length) as Id<'_storage'>;
    const url = await convex.query(api.storage.getUrl, { storageId });
    if (!url) return jsonResponse({ error: 'Label not found' }, 404);
    return Response.redirect(url, 302);
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
        if (!shipment.labelUrl) return jsonResponse({ error: 'Label not found' }, 404);

        if (shipment.labelUrl.startsWith(CONVEX_STORAGE_MARKER_PREFIX)) {
            return redirectConvexStorage(convex, shipment.labelUrl);
        }

        // Imported labels still carry their pre-migration marker; the storage
        // map resolves those to the object uploaded during the import.
        const migratedUrl = await convex.query(api.storage.resolveLegacyUrl, { url: shipment.labelUrl });
        if (migratedUrl) return Response.redirect(migratedUrl, 302);

        // Legacy or failed-upload path: labelUrl is the raw Sendcloud document
        // URL, which needs Basic auth to fetch. Move it into storage now so
        // future clicks are instant.
        try {
            const pdfBytes = await downloadSendcloudLabelPdf(shipment.labelUrl);
            const newMarker = await uploadLabelPdf(shipment.publicId, pdfBytes, request);
            await convex.mutation(api.orders.updateShipmentLabelUrl, {
                shipmentId,
                labelUrl: newMarker,
            });
            return redirectConvexStorage(convex, newMarker);
        } catch (migrationErr) {
            console.error('Label migration failed:', migrationErr);
            return jsonResponse({ error: 'No se pudo descargar la etiqueta de Sendcloud' }, 500);
        }
    } catch (err) {
        console.error('Sendcloud label error:', err);
        return jsonResponse({ error: 'Failed to get label' }, 500);
    }
};
