import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';

import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../../lib/core/file-validation';
import { securityLog } from '../../../../lib/core/security-log';

const EXT_BY_TYPE: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export const POST: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null;

    if (!file || !type || !['profile', 'banner'].includes(type)) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    }

    const detectedType = await detectImageMimeType(file);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.includes(detectedType)) {
        securityLog('security.upload.invalid_magic_bytes', { userId: user.id, context: `shop_${type}` });
        return new Response(JSON.stringify({ error: t.apiFileInvalid }), { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    }

    const folder = type === 'profile' ? 'profiles' : 'banners';
    const ext = EXT_BY_TYPE[detectedType] ?? 'jpg';
    const filename = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const path = `${folder}/${filename}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
        .from('imgs')
        .upload(path, buffer, {
            contentType: detectedType,
            upsert: false,
        });

    if (uploadError) {
        return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
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
    if (segments.length < 3 || !['profiles', 'banners'].includes(segments[0])) {
        return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    }

    if (segments[1] !== user.id) {
        return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    }

    const { error } = await supabase.storage
        .from('imgs')
        .remove([path]);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};