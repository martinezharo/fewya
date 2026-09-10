import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { downloadSendcloudLabelPdf } from '../../../lib/shipping/sendcloud';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { uploadLabelPdf } from '../../../lib/shipping/labelStorage';

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
        // The query authorizes the caller as the order's buyer or seller and
        // resolves the label in the same breath — a stored label, whether
        // uploaded here or imported, never needs a second lookup.
        const shipment = await convex.query(api.orders.getShipmentForAccess, { shipmentId });
        if (!shipment) return jsonResponse({ error: 'Shipment not found' }, 404);
        if (!shipment.labelUrl) return jsonResponse({ error: 'Label not found' }, 404);
        if (shipment.resolvedLabelUrl && shipment.resolvedLabelUrl !== shipment.labelUrl) {
            return Response.redirect(shipment.resolvedLabelUrl, 302);
        }

        // Legacy or failed-upload path: labelUrl is the raw Sendcloud document
        // URL, which needs Basic auth to fetch. Move it into storage now so
        // future clicks are instant.
        try {
            const pdfBytes = await downloadSendcloudLabelPdf(shipment.labelUrl);
            const { marker, url: storedUrl } = await uploadLabelPdf(pdfBytes, request);
            await convex.mutation(api.orders.updateShipmentLabelUrl, {
                shipmentId,
                labelUrl: marker,
            });
            return Response.redirect(storedUrl, 302);
        } catch (migrationErr) {
            console.error('Label migration failed:', migrationErr);
            return jsonResponse({ error: 'No se pudo descargar la etiqueta de Sendcloud' }, 500);
        }
    } catch (err) {
        console.error('Sendcloud label error:', err);
        return jsonResponse({ error: 'Failed to get label' }, 500);
    }
};
