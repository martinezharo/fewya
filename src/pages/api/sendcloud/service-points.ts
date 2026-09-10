import type { APIRoute } from 'astro';
import { getServicePoints } from '../../../lib/shipping/sendcloud';
import { normalizeShippingPlatforms } from '../../../lib/shipping/shippingPlatform';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ locals, url, request, cookies  }) => {
    const { t } = locals;
    const { createSupabaseAuthClient } = await import('../../../lib/core/auth');
    const authClient = createSupabaseAuthClient(cookies, request);

    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const address = url.searchParams.get('address');
    const country = url.searchParams.get('country') || 'ES';

    if (!address) {
        return jsonResponse({ error: 'Address required' }, 400);
    }

    // Optional platform filter (comma-separated shipping platforms, as returned
    // by /api/cart/delivery-options). Falls back to every platform when absent
    // or invalid. Sendcloud's own carrier codes never travel over the wire —
    // they are an implementation detail of the shipping layer.
    const platforms = normalizeShippingPlatforms(
        (url.searchParams.get('platforms') || '').split(',').map((value) => value.trim().toLowerCase()),
    );

    try {
        const points = await getServicePoints(address, country, platforms);
        return jsonResponse({ points }, 200);
    } catch (err) {
        console.error('Sendcloud service points error:', err);
        return jsonResponse({ error: t.deliverySearchError }, 500);
    }
};
