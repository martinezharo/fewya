import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { strings } from '../../../lib/core/i18n';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ cookies, request }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const orderId = formData.get('orderId') as string | null;

    if (!file || !orderId) {
        return new Response(JSON.stringify({ error: 'Missing file or orderId' }), { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
        return new Response(JSON.stringify({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }), { status: 400 });
    }

    if (file.size > MAX_SIZE) {
        return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), { status: 400 });
    }

    // Verify the order belongs to the user and is in a reportable state
    const adminClient = createSupabaseAdminClient();
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select('id, buyer_id, status')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 });
    }

    if (order.buyer_id !== user.id) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    if (!['delivered', 'confirmed'].includes(order.status)) {
        return new Response(JSON.stringify({ error: 'Order cannot be reported at this stage' }), { status: 400 });
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${orderId}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await adminClient.storage
        .from('imgs')
        .upload(`incidents/${filename}`, buffer, {
            contentType: file.type,
            upsert: false,
        });

    if (uploadError) {
        return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
    }

    const { data: urlData } = adminClient.storage
        .from('imgs')
        .getPublicUrl(`incidents/${filename}`);

    return new Response(JSON.stringify({ url: urlData.publicUrl, path: filename }), { status: 200 });
};
