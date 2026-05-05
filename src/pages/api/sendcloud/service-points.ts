import type { APIRoute } from 'astro';
import { getServicePoints } from '../../../lib/sendcloud';
import { strings } from '../../../lib/i18n';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ url, request, cookies }) => {
    const { createSupabaseAuthClient } = await import('../../../lib/auth');
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

    try {
        const points = await getServicePoints(address, country, ['correos', 'inpost']);
        console.log('[sendcloud service-points]', address, '=> found', points.length, 'points');
        return jsonResponse({ points }, 200);
    } catch (err) {
        console.error('Sendcloud service points error:', err);
        return jsonResponse({ error: strings.deliverySearchError }, 500);
    }
};