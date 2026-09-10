import { uploadConvexBytes } from '../core/convexStorage';

/**
 * Stores a shipping label in Convex Storage.
 *
 * Returns both the marker to persist on the shipment and the URL the upload
 * already resolved, so serving the label back does not need a second lookup.
 * The upload is authorized by the caller's own session, which is why the
 * originating request is required: a label may only be written by the seller
 * who is generating it.
 */
export async function uploadLabelPdf(
    pdfBytes: Uint8Array,
    request: Request,
): Promise<{ marker: string; url: string }> {
    const uploaded = await uploadConvexBytes(request, pdfBytes, 'application/pdf');
    return { marker: uploaded.path, url: uploaded.url };
}
