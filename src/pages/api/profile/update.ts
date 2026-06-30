import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';

// A4: field length limits to prevent storage DoS and stored-XSS from oversized values
const FIELD_LIMITS: Record<string, number> = {
    first_name: 80,
    last_name: 100,
    phone: 32,
    phone_prefix: 8,
    address_street: 200,
    address_number: 20,
    address_floor: 30,
    address_postal_code: 16,
    address_city: 80,
    address_province: 64,
    address_country: 64,
    avatar_url: 512,
};

const PHONE_RE = /^[0-9\s]{3,30}$/;
const PHONE_PREFIX_RE = /^\+?\d{1,4}$/;

type ProfileUpdateBody = {
    first_name?: unknown;
    last_name?: unknown;
    avatar_url?: unknown;
    phone?: unknown;
    phone_prefix?: unknown;
    address_street?: unknown;
    address_number?: unknown;
    address_floor?: unknown;
    address_postal_code?: unknown;
    address_city?: unknown;
    address_province?: unknown;
    address_country?: unknown;
    email_marketing_opt_in?: unknown;
};

function validateStringField(value: unknown, field: string): string | Response {
    if (typeof value !== 'string') {
        return new Response(JSON.stringify({ error: `invalid_${field}` }), { status: 400 });
    }
    const trimmed = value.trim();
    const limit = FIELD_LIMITS[field];
    if (limit && trimmed.length > limit) {
        return new Response(JSON.stringify({ error: `invalid_${field}` }), { status: 400 });
    }
    return trimmed;
}

export const POST: APIRoute = async ({ locals, cookies, request  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const body = await request.json() as ProfileUpdateBody;
    const {
        first_name,
        last_name,
        avatar_url,
        phone,
        phone_prefix,
        address_street,
        address_number,
        address_floor,
        address_postal_code,
        address_city,
        address_province,
        address_country,
        email_marketing_opt_in,
    } = body ?? {};

    const updates: Record<string, string | boolean | null> = {};

    const stringFields: Array<[string, unknown]> = [
        ['first_name', first_name],
        ['last_name', last_name],
        ['address_street', address_street],
        ['address_number', address_number],
        ['address_floor', address_floor],
        ['address_postal_code', address_postal_code],
        ['address_city', address_city],
        ['address_province', address_province],
        ['address_country', address_country],
    ];

    for (const [field, value] of stringFields) {
        if (value === undefined) continue;
        const result = validateStringField(value, field);
        if (result instanceof Response) return result;
        updates[field] = result || null;
    }

    if (phone !== undefined) {
        const result = validateStringField(phone, 'phone');
        if (result instanceof Response) return result;
        if (result && !PHONE_RE.test(result)) {
            return new Response(JSON.stringify({ error: 'invalid_phone' }), { status: 400 });
        }
        updates.phone = result || null;
    }

    if (phone_prefix !== undefined) {
        const result = validateStringField(phone_prefix, 'phone_prefix');
        if (result instanceof Response) return result;
        if (result && !PHONE_PREFIX_RE.test(result)) {
            return new Response(JSON.stringify({ error: 'invalid_phone_prefix' }), { status: 400 });
        }
        updates.phone_prefix = result || null;
    }

    if (avatar_url !== undefined) {
        if (avatar_url === null) {
            updates.avatar_url = null;
        } else {
            const result = validateStringField(avatar_url, 'avatar_url');
            if (result instanceof Response) return result;
            updates.avatar_url = result || null;
        }
    }

    if (email_marketing_opt_in !== undefined) {
        if (typeof email_marketing_opt_in !== 'boolean') {
            return new Response(JSON.stringify({ error: 'invalid_email_marketing_opt_in' }), { status: 400 });
        }
        updates.email_marketing_opt_in = email_marketing_opt_in;
    }

    if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: 'no_fields' }), { status: 400 });
    }

    const { error } = await authClient
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

    if (error) {
        // M3: don't expose DB error details
        console.error(JSON.stringify({ event: 'profile_update.failed', error: error.message }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
