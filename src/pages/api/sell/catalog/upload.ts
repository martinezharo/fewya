import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { strings } from '../../../../lib/core/i18n';

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

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        return new Response(JSON.stringify({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }), { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${shop.id}/${crypto.randomUUID()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
        .from('imgs')
        .upload(`products/${filename}`, buffer, {
            contentType: file.type,
            upsert: false,
        });

    if (uploadError) {
        return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
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

    const path = url.searchParams.get('path');
    if (!path) {
        return new Response(JSON.stringify({ error: 'No path provided' }), { status: 400 });
    }

    const { error } = await supabase.storage
        .from('imgs')
        .remove([path]);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};