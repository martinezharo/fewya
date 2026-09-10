import { uploadConvexBytes } from '../core/convexStorage';

/**
 * Stores a shipping label in Convex Storage and returns its marker path.
 *
 * The upload is authorized by the caller's own session, which is why the
 * originating request is required: a label may only be written by the seller
 * who is generating it.
 */
export async function uploadLabelPdf(pdfBytes: Uint8Array, request: Request): Promise<string> {
    const uploaded = await uploadConvexBytes(request, pdfBytes, 'application/pdf');
    return uploaded.path;
}
