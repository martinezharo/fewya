import { createSupabaseAdminClient } from '../core/supabase-admin';
import { convexOnly } from '../core/env';
import { uploadConvexBytes } from '../core/convexStorage';

export const LABELS_BUCKET = 'labels';

export function buildLabelPath(orderPublicId: string): string {
    return `${orderPublicId}.pdf`;
}

export function buildLabelUrlMarker(orderPublicId: string): string {
    return `${LABELS_BUCKET}:${buildLabelPath(orderPublicId)}`;
}

export async function uploadLabelPdf(
    orderPublicId: string,
    pdfBytes: Uint8Array,
    request?: Request,
): Promise<string> {
    if (convexOnly) {
        if (!request) throw new Error('Convex request is required for label uploads');
        const uploaded = await uploadConvexBytes(request, pdfBytes, 'application/pdf');
        return uploaded.path;
    }
    const path = buildLabelPath(orderPublicId);
    const adminClient = createSupabaseAdminClient();
    const { error } = await adminClient.storage
        .from(LABELS_BUCKET)
        .upload(path, pdfBytes, {
            contentType: 'application/pdf',
            upsert: true,
        });
    if (error) {
        throw new Error(`labelStorage upload failed: ${error.message}`);
    }
    return buildLabelUrlMarker(orderPublicId);
}
