import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';

type ProfileUpdateBody = {
    first_name?: unknown;
    last_name?: unknown;
    phone?: unknown;
    phone_prefix?: unknown;
    address_street?: unknown;
    address_number?: unknown;
    address_floor?: unknown;
    address_postal_code?: unknown;
    address_city?: unknown;
    address_province?: unknown;
    address_country?: unknown;
};

export const POST: APIRoute = async ({ cookies, request }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    const body = await request.json() as ProfileUpdateBody;
    const {
        first_name,
        last_name,
        phone,
        phone_prefix,
        address_street,
        address_number,
        address_floor,
        address_postal_code,
        address_city,
        address_province,
        address_country,
    } = body ?? {};

    const updates: Record<string, string> = {};

    if (first_name !== undefined) {
        if (typeof first_name !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_first_name' }), { status: 400 });
        }
        updates.first_name = first_name.trim();
    }

    if (last_name !== undefined) {
        if (typeof last_name !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_last_name' }), { status: 400 });
        }
        updates.last_name = last_name.trim();
    }

    if (phone !== undefined) {
        if (typeof phone !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_phone' }), { status: 400 });
        }
        updates.phone = phone.trim();
    }

    if (phone_prefix !== undefined) {
        if (typeof phone_prefix !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_phone_prefix' }), { status: 400 });
        }
        updates.phone_prefix = phone_prefix.trim();
    }

    if (address_street !== undefined) {
        if (typeof address_street !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_street' }), { status: 400 });
        }
        updates.address_street = address_street.trim();
    }

    if (address_number !== undefined) {
        if (typeof address_number !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_number' }), { status: 400 });
        }
        updates.address_number = address_number.trim();
    }

    if (address_floor !== undefined) {
        if (typeof address_floor !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_floor' }), { status: 400 });
        }
        updates.address_floor = address_floor.trim();
    }

    if (address_postal_code !== undefined) {
        if (typeof address_postal_code !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_postal_code' }), { status: 400 });
        }
        updates.address_postal_code = address_postal_code.trim();
    }

    if (address_city !== undefined) {
        if (typeof address_city !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_city' }), { status: 400 });
        }
        updates.address_city = address_city.trim();
    }

    if (address_province !== undefined) {
        if (typeof address_province !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_province' }), { status: 400 });
        }
        updates.address_province = address_province.trim();
    }

    if (address_country !== undefined) {
        if (typeof address_country !== 'string') {
            return new Response(JSON.stringify({ error: 'invalid_address_country' }), { status: 400 });
        }
        updates.address_country = address_country.trim();
    }

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