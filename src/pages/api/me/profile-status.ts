import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';
import { isProfileComplete } from '../../../lib/core/validation';

export const GET: APIRoute = async ({ cookies, request }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { data: profile } = await authClient
        .from('profiles')
        .select('first_name, last_name, phone, address_street, address_number, address_postal_code, address_city, address_province, address_country')
        .eq('id', user.id)
        .single();

    const result = isProfileComplete(profile ?? {});

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
