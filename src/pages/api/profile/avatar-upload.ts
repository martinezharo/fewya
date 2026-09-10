import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser } from '../../../lib/core/auth';
import { api } from '../../../../convex/_generated/api';

import { uploadConvexFile } from '../../../lib/core/convexStorage';
import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../lib/core/file-validation';
import { securityLog } from '../../../lib/core/security-log';

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!user || !convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    }

    // A6: validate by magic bytes
    const detectedType = await detectImageMimeType(file);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.includes(detectedType)) {
        securityLog('security.upload.invalid_magic_bytes', { userId: user.id, context: 'avatar' });
        return new Response(JSON.stringify({ error: t.apiFileInvalid }), { status: 400 });
    }

    if (file.size > 2 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File too large. Max 2MB.' }), { status: 400 });
    }

    try {
        // The upload records the caller as the file's owner, and attaching it
        // to the profile hands back the URL, so no separate resolve is needed.
        const { storageId } = await uploadConvexFile(request, file, detectedType);
        const { avatarUrl, url } = await convex.mutation(api.users.setAvatarStorage, { storageId });
        return new Response(JSON.stringify({ url, path: avatarUrl }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'avatar_upload.failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    try {
        // Convex clears the avatar on the caller's own profile and removes the
        // stored object, so no client-supplied path can be targeted.
        await convex.mutation(api.users.deleteAvatarStorage, {});
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'avatar_delete.failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
