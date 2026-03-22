import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';

type ProfileUpdateBody = {
    full_name?: unknown;
    phone?: unknown;
    address?: unknown;
};

export const POST: APIRoute = async ({ cookies, request }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    const body = await request.json() as ProfileUpdateBody;
    const { full_name, phone, address } = body ?? {};

    // Validate required fields
    if (full_name !== undefined && typeof full_name !== 'string') {
        return new Response(JSON.stringify({ error: 'invalid_full_name' }), { status: 400 });
    }
    if (phone !== undefined && typeof phone !== 'string') {
        return new Response(JSON.stringify({ error: 'invalid_phone' }), { status: 400 });
    }
    if (address !== undefined && typeof address !== 'string') {
        return new Response(JSON.stringify({ error: 'invalid_address' }), { status: 400 });
    }

    const updates: Record<string, string> = {};
    if (full_name !== undefined) updates.full_name = full_name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (address !== undefined) updates.address = address.trim();

    if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: 'no_fields' }), { status: 400 });
    }

    const { error } = await authClient
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
