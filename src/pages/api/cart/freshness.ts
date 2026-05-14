import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/core/supabase';
import { strings } from '../../../lib/core/i18n';

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

export const POST: APIRoute = async ({ request }) => {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    const raw = Array.isArray(body.variantIds) ? body.variantIds : [];
    const variantIds = raw.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);

    if (variantIds.length === 0) {
        return jsonResponse({ items: [] }, 200);
    }

    const { data, error } = await supabase
        .from('product_variants')
        .select(`
            id,
            price,
            stock,
            shipping_cost,
            products!inner ( is_active, shops!inner ( is_active ) )
        `)
        .in('id', variantIds);

    if (error) {
        return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 500);
    }

    type FreshnessRow = {
        id: string;
        price: number | null;
        stock: number | null;
        shipping_cost: number | null;
        products: { is_active: boolean | null; shops: { is_active: boolean | null } | { is_active: boolean | null }[] | null } | { is_active: boolean | null; shops: { is_active: boolean | null } | { is_active: boolean | null }[] | null }[] | null;
    };

    const items: CartFreshnessItem[] = ((data ?? []) as FreshnessRow[]).map((row) => {
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        const shop = product && (Array.isArray(product.shops) ? product.shops[0] : product.shops);
        const isAvailable = Boolean(product?.is_active && shop?.is_active && Number(row.stock ?? 0) > 0);
        return {
            variantId: row.id as string,
            stock: Number(row.stock ?? 0),
            price: Number(row.price ?? 0),
            shippingCost: Number(row.shipping_cost ?? 0),
            isAvailable,
        };
    });

    // Variants missing from DB → mark explicitly as unavailable
    const found = new Set(items.map((i) => i.variantId));
    for (const id of variantIds) {
        if (!found.has(id)) {
            items.push({ variantId: id, stock: 0, price: 0, shippingCost: 0, isAvailable: false });
        }
    }

    return jsonResponse({ items }, 200);
};
