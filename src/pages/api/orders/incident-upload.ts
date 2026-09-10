import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';
import { uploadConvexFile } from '../../../lib/core/convexStorage';

import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../lib/core/file-validation';
import { securityLog } from '../../../lib/core/security-log';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

const MAX_SIZE = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);
    if (!user || !convex) return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const orderId = formData.get('orderId') as string | null;

    if (!file || !orderId) {
        return new Response(JSON.stringify({ error: 'Missing file or orderId' }), { status: 400 });
    }

    // A6: validate by magic bytes
    const detectedType = await detectImageMimeType(file);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.includes(detectedType)) {
        securityLog('security.upload.invalid_magic_bytes', { userId: user.id, context: 'incident' });
        return new Response(JSON.stringify({ error: t.apiFileInvalid }), { status: 400 });
    }

    if (file.size > MAX_SIZE) {
        return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    }

    try {
        const order = await convex.query(api.orders.getIncidentUploadContext, { orderId });
        if (!([ORDER_STATUS.DELIVERED, ORDER_STATUS.CONFIRMED] as string[]).includes(order.status)) {
            return new Response(JSON.stringify({ error: 'Order cannot be reported at this stage' }), { status: 400 });
        }
    } catch {
        return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 });
    }

    try {
        const uploaded = await uploadConvexFile(request, file, detectedType);
        return new Response(JSON.stringify(uploaded), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'incident_upload.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
