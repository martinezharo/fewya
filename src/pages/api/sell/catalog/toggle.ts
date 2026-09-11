import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { enforceVariantPricing, type PricingCheckVariant } from '../../../../lib/products/pricingEnforcement';

export const PATCH: APIRoute = async ({ locals, request, url }) => {
    const { t, locale } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    let isActive: boolean;
    try {
        const body = await request.json();
        if (typeof body !== 'object' || body === null) throw new Error('not an object');
        const value = (body as Record<string, unknown>).is_active;
        if (typeof value !== 'boolean') throw new Error('is_active must be a boolean');
        isActive = value;
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    try {
        // Loss protection: activating a product re-checks its stored variants
        // against a live carrier quote unless the shop opted out.
        if (isActive) {
            const context = await convex.query(api.seller.pricingContext, { productId });
            if (!context.allowLoss) {
                const pricing = await enforceVariantPricing(t, locale, context.variants as PricingCheckVariant[]);
                if (!pricing.ok) {
                    return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
                }
            }
        }

        const result = await convex.mutation(api.seller.toggleProduct, { productId, isActive });
        return new Response(JSON.stringify({ product: result.product }), { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ error: message.includes('access') ? t.apiForbidden : t.apiInternalError }), { status: message.includes('access') ? 403 : 500 });
    }
};
