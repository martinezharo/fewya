import type { APIRoute } from 'astro';
import { createConvexClient } from '../../../lib/core/convex';
import { api } from '../../../../convex/_generated/api';

interface RequestBody {
    variantIds?: unknown;
}

export interface CartFreshnessItem {
    variantId: string;
    stock: number;
    price: number;
    shippingCost: number;
    isAvailable: boolean;
}

function jsonResponse(payload: unknown, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

export const POST: APIRoute = async ({ locals, request  }) => {
    const { t } = locals;
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    const raw = Array.isArray(body.variantIds) ? body.variantIds : [];
    const variantIds = raw.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);

    if (variantIds.length === 0) {
        return jsonResponse({ items: [] }, 200);
    }

    const convex = createConvexClient();
    if (!convex) return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 503);
    try {
        const data = await convex.query(api.catalog.getCartVariants, { ids: variantIds });
        const items: CartFreshnessItem[] = data.map((row) => ({
            variantId: row.id,
            stock: row.stock,
            price: row.price,
            shippingCost: row.shipping_cost ?? 0,
            isAvailable: Boolean(row.product.is_active && row.product.shop.is_active && row.stock > 0),
        }));
        const found = new Set(items.map((item) => item.variantId));
        for (const id of variantIds) if (!found.has(id)) items.push({ variantId: id, stock: 0, price: 0, shippingCost: 0, isAvailable: false });
        return jsonResponse({ items }, 200);
    } catch (error) {
        console.error(JSON.stringify({ event: 'cart_freshness.failed', error: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 500);
    }
};
