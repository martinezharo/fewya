import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { strings } from '../../../../lib/core/i18n';
import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../../lib/core/file-validation';
import { securityLog } from '../../../../lib/core/security-log';

export const POST: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
        return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 });
    }

    // A6: validate by magic bytes, not client-declared Content-Type
    const detectedType = await detectImageMimeType(file);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.includes(detectedType)) {
        securityLog('security.upload.invalid_magic_bytes', { userId: user.id, shopId: shop.id });
        return new Response(JSON.stringify({ error: strings.apiFileInvalid }), { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    }

    const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    const ext = extMap[detectedType] ?? 'jpg';
    const filename = `${shop.id}/${crypto.randomUUID()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
        .from('imgs')
        .upload(`products/${filename}`, buffer, {
            contentType: detectedType, // use validated type, not client-declared
            upsert: false,
        });

    if (uploadError) {
        // M3: don't expose storage error details
        console.error(JSON.stringify({ event: 'catalog_upload.failed', error: uploadError.message }));
        return new Response(JSON.stringify({ error: strings.apiInternalError }), { status: 500 });
    }

    const { data: urlData } = supabase.storage
        .from('imgs')
        .getPublicUrl(`products/${filename}`);

    return new Response(JSON.stringify({ url: urlData.publicUrl, path: filename }), { status: 200 });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    // Load the seller's shop to validate path ownership
    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    const path = url.searchParams.get('path');
    if (!path) {
        return new Response(JSON.stringify({ error: 'No path provided' }), { status: 400 });
    }

    // A3: validate path is scoped to this seller's shop — pattern: {shopId}/{uuid}.{ext}
    const segments = path.split('/');
    if (segments.length !== 2 || segments[0] !== shop.id) {
        securityLog('security.upload.path_traversal', { userId: user.id, path });
        return new Response(JSON.stringify({ error: strings.apiPathForbidden }), { status: 400 });
    }

    const { error } = await supabase.storage
        .from('imgs')
        .remove([`products/${path}`]);

    if (error) {
        console.error(JSON.stringify({ event: 'catalog_delete.failed', error: error.message }));
        return new Response(JSON.stringify({ error: strings.apiInternalError }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
