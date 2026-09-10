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

    let body: { is_active: boolean };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    try {
        // Loss protection: activating a product re-checks its stored variants
        // against a live carrier quote unless the shop opted out.
        if (body.is_active === true) {
            const context = await convex.query(api.seller.pricingContext, { productId });
            if (!context.allowLoss) {
                const pricing = await enforceVariantPricing(t, locale, context.variants as PricingCheckVariant[]);
                if (!pricing.ok) {
                    return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
                }
            }
        }

        const result = await convex.mutation(api.seller.toggleProduct, { productId, isActive: body.is_active });
        return new Response(JSON.stringify({ product: result.product }), { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ error: message.includes('access') ? t.apiForbidden : t.apiInternalError }), { status: message.includes('access') ? 403 : 500 });
    }
};
