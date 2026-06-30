import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';

import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../lib/core/file-validation';
import { securityLog } from '../../../lib/core/security-log';

export const POST: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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

    const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    const ext = extMap[detectedType] ?? 'jpg';
    const filename = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const path = `avatars/${filename}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
        .from('imgs')
        .upload(path, buffer, {
            contentType: detectedType, // use validated type
            upsert: false,
        });

    if (uploadError) {
        console.error(JSON.stringify({ event: 'avatar_upload.failed', error: uploadError.message }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }

    const { data: urlData } = supabase.storage
        .from('imgs')
        .getPublicUrl(path);

    return new Response(JSON.stringify({ url: urlData.publicUrl, path }), { status: 200 });
};

export const DELETE: APIRoute = async ({ locals, cookies, request, url  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const path = url.searchParams.get('path');
    if (!path) {
        return new Response(JSON.stringify({ error: 'No path provided' }), { status: 400 });
    }

    const segments = path.split('/');
    if (segments.length < 3 || segments[0] !== 'avatars') {
        return new Response(JSON.stringify({ error: t.apiPathForbidden }), { status: 403 });
    }

    if (segments[1] !== user.id) {
        return new Response(JSON.stringify({ error: t.apiPathForbidden }), { status: 403 });
    }

    const { error } = await supabase.storage
        .from('imgs')
        .remove([path]);

    if (error) {
        console.error(JSON.stringify({ event: 'avatar_delete.failed', error: error.message }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
