import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { convexOnly } from '../../../lib/core/env';

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

    let profile: {
        address_street?: string | null;
        address_number?: string | null;
        address_floor?: string | null;
        address_postal_code?: string | null;
        address_city?: string | null;
        address_province?: string | null;
        address_country?: string | null;
    } | null = null;

    const convexToken = getRequestConvexToken(request);
    const convex = convexToken ? createConvexClient(convexToken) : null;
    if (convex) {
        const current = await convex.query(api.users.current, {});
        if (current) {
            profile = {
                address_street: current.addressStreet,
                address_number: current.addressNumber,
                address_floor: current.addressFloor,
                address_postal_code: current.addressPostalCode,
                address_city: current.addressCity,
                address_province: current.addressProvince,
                address_country: current.addressCountry,
            };
        }
    }
    if (!profile && !convexToken && !convexOnly) {
        const { data } = await authClient
            .from('profiles')
            .select('address_street, address_number, address_floor, address_postal_code, address_city, address_province, address_country')
            .eq('id', user.id)
            .single();
        profile = data;
    }

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
