import { uploadConvexBytes } from '../core/convexStorage';

export const LABELS_BUCKET = 'labels';

export function buildLabelPath(orderPublicId: string): string {
    return `${orderPublicId}.pdf`;
}

export function buildLabelUrlMarker(orderPublicId: string): string {
    return `${LABELS_BUCKET}:${buildLabelPath(orderPublicId)}`;
}

/** Stores a shipping label in Convex Storage and returns its marker path. */
export async function uploadLabelPdf(
    orderPublicId: string,
    pdfBytes: Uint8Array,
    request?: Request,
): Promise<string> {
    if (!request) throw new Error('Convex request is required for label uploads');
    const uploaded = await uploadConvexBytes(request, pdfBytes, 'application/pdf');
    return uploaded.path;
}
