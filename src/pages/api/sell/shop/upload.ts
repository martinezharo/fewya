import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser } from '../../../../lib/core/auth';
import { uploadConvexFile, deleteConvexFile } from '../../../../lib/core/convexStorage';

import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../../lib/core/file-validation';
import { securityLog } from '../../../../lib/core/security-log';

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!user || !convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null;
    if (!file || !type || !['profile', 'banner'].includes(type)) return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    const detectedType = await detectImageMimeType(file);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.includes(detectedType)) {
        securityLog('security.upload.invalid_magic_bytes', { userId: user.id, context: `shop_${type}` });
        return new Response(JSON.stringify({ error: t.apiFileInvalid }), { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    try {
        const uploaded = await uploadConvexFile(request, file, detectedType);
        return new Response(JSON.stringify(uploaded), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'shop_upload.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ locals, request, url }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!user || !convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const path = url.searchParams.get('path');
    if (!path) return new Response(JSON.stringify({ error: 'No path provided' }), { status: 400 });
    try {
        await deleteConvexFile(request, path);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'shop_delete.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
