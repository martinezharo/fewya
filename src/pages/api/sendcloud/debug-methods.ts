import type { APIRoute } from 'astro';
import { getShippingQuotes } from '../../../lib/shipping/sendcloud';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
    const { createSupabaseAuthClient } = await import('../../../lib/core/auth');
    const authClient = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const weight = parseFloat(url.searchParams.get('weight') ?? '1');
    const country = (url.searchParams.get('country') ?? 'ES').toUpperCase();

    try {
        const quotes = await getShippingQuotes('', 'ES', '', country, [{ weight }]);
        return jsonResponse({
            count: quotes.length,
            weight_kg: weight,
            country,
            methods: quotes.map((q) => ({
                serviceName: q.serviceName,
                carrierId: q.carrierId,
                carrierName: q.carrierName,
                servicePointInput: q.servicePointInput,
                shippingOptionCode: q.shippingOptionCode,
                price: q.price,
                currency: q.currency,
                minWeightKg: q.minWeightKg,
                maxWeightKg: q.maxWeightKg,
            })),
        }, 200);
    } catch (err) {
        return jsonResponse({ error: String(err) }, 502);
    }
};
