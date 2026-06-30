import type { APIRoute } from 'astro';
import { getServicePoints } from '../../../lib/shipping/sendcloud';

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

    // Optional carrier filter (comma-separated sendcloud carrier codes). Falls
    // back to all supported carriers when absent or empty.
    const carriersParam = (url.searchParams.get('carriers') || '')
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c === 'correos' || c === 'inpost');
    const carriers = carriersParam.length > 0 ? carriersParam : ['correos', 'inpost'];

    try {
        const points = await getServicePoints(address, country, carriers);
        return jsonResponse({ points }, 200);
    } catch (err) {
        console.error('Sendcloud service points error:', err);
        return jsonResponse({ error: t.deliverySearchError }, 500);
    }
};
