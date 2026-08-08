import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createConvexClient } from '../../../lib/core/convex';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
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

    let profile: Record<string, unknown> | null = null;
    const convexToken = getRequestConvexToken(request);
    const convex = convexToken ? createConvexClient(convexToken) : null;
    if (convex) {
        const current = await convex.query(api.users.current, {});
        profile = current ? {
            first_name: current.firstName,
            last_name: current.lastName,
            phone: current.phone,
            address_street: current.addressStreet,
            address_number: current.addressNumber,
            address_postal_code: current.addressPostalCode,
            address_city: current.addressCity,
            address_province: current.addressProvince,
            address_country: current.addressCountry,
        } : null;
    }
    if (!profile && !convexToken) {
        const { data } = await authClient
            .from('profiles')
            .select('first_name, last_name, phone, address_street, address_number, address_postal_code, address_city, address_province, address_country')
            .eq('id', user.id)
            .single();
        profile = data;
    }

    const result = isProfileComplete(profile ?? {});

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
