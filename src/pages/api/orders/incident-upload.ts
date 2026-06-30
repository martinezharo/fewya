import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';

import { detectImageMimeType, ALLOWED_IMAGE_TYPES } from '../../../lib/core/file-validation';
import { securityLog } from '../../../lib/core/security-log';
import { ORDER_STATUS } from '../../../lib/orders/orderStatus';

const MAX_SIZE = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

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
        return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    }

    if (!([ORDER_STATUS.DELIVERED, ORDER_STATUS.CONFIRMED] as string[]).includes(order.status)) {
        return new Response(JSON.stringify({ error: 'Order cannot be reported at this stage' }), { status: 400 });
    }

    const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    const ext = extMap[detectedType] ?? 'jpg';
    const filename = `${orderId}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await adminClient.storage
        .from('imgs')
        .upload(`incidents/${filename}`, buffer, {
            contentType: detectedType, // use validated type
            upsert: false,
        });

    if (uploadError) {
        console.error(JSON.stringify({ event: 'incident_upload.failed', error: uploadError.message }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }

    const { data: urlData } = adminClient.storage
        .from('imgs')
        .getPublicUrl(`incidents/${filename}`);

    return new Response(JSON.stringify({ url: urlData.publicUrl, path: filename }), { status: 200 });
};
