import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';

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
        .select('address_street, address_number, address_floor, address_postal_code, address_city, address_province, address_country')
        .eq('id', user.id)
        .single();

    const street = profile?.address_street?.trim() || '';
    const number = profile?.address_number?.trim() || '';
    const floor = profile?.address_floor?.trim() || '';
    const postalCode = profile?.address_postal_code?.trim() || '';
    const city = profile?.address_city?.trim() || '';
    const province = profile?.address_province?.trim() || '';
    const country = profile?.address_country?.trim() || 'ES';

    const addressParts = [
        street && number ? `${street} ${number}` : street,
        floor,
        postalCode ? `${postalCode} ${city}` : city,
        province,
        country !== 'ES' ? country : null,
    ].filter(Boolean);

    const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : null;

    return new Response(JSON.stringify({
        postalCode: postalCode || null,
        city: city || null,
        country,
        fullAddress,
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};