import type { APIRoute } from 'astro';
import {
    getShippingQuotes,
    calculateParcelFromItems,
    DEFAULT_SHOP_SHIPPING_EUR,
} from '../../../lib/shipping/sendcloud';

interface QuoteItem {
    variantId: string;
    quantity: number;
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const { createSupabaseAuthClient } = await import('../../../lib/core/auth');
    const authClient = createSupabaseAuthClient(cookies, request);

    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body: {
        items: QuoteItem[];
        toPostalCode: string;
        toCountry: string;
    };

    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid body' }, 400);
    }

    const { items, toPostalCode, toCountry } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return jsonResponse({ error: 'Items are required' }, 400);
    }

    if (!toPostalCode || !toCountry) {
        return jsonResponse({ error: 'Destination address required' }, 400);
    }

    const variantIds = items.map((i) => i.variantId);

    const { createClient } = await import('@supabase/supabase-js');
    const { SUPABASE_URL, SUPABASE_KEY } = await import('astro:env/server');
    const supabase = createClient(SUPABASE_URL as string, SUPABASE_KEY as string);

    const { data: variants, error } = await supabase
        .from('product_variants')
        .select('id, weight_kg, length_cm, width_cm, height_cm')
        .in('id', variantIds);

    if (error || !variants) {
        return jsonResponse({ error: 'Failed to fetch product dimensions' }, 500);
    }

    const variantMap = new Map((variants as any[]).map((v) => [v.id, v]));

    const itemsWithDimensions = items
        .map((item) => {
            const variant = variantMap.get(item.variantId);
            return {
                variantId: item.variantId,
                quantity: item.quantity,
                weightKg: (variant as any)?.weight_kg,
                lengthCm: (variant as any)?.length_cm,
                widthCm: (variant as any)?.width_cm,
                heightCm: (variant as any)?.height_cm,
            };
        })
        .filter((item) => variantMap.has(item.variantId));

    if (itemsWithDimensions.length === 0) {
        return jsonResponse({ error: 'No valid items found' }, 400);
    }

    const fromPostalCode = '28001';
    const fromCountry = 'ES';

    const parcels = calculateParcelFromItems(itemsWithDimensions);

    try {
        const quotes = await getShippingQuotes(
            fromPostalCode,
            fromCountry,
            toPostalCode,
            toCountry,
            parcels
        );

        return jsonResponse({ quotes }, 200);
    } catch (err) {
        console.error('Sendcloud quote error:', err);
        return jsonResponse({ error: 'Failed to get shipping quotes', fallbackRate: DEFAULT_SHOP_SHIPPING_EUR }, 500);
    }
};
