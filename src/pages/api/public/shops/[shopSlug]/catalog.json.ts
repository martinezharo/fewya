import type { APIRoute } from 'astro';
import { APP_BASE_URL } from 'astro:env/server';
import { supabase } from '../../../../../lib/core/supabase';
import { SHOP_STATUS } from '../../../../../lib/core/shopStatus';
import { buildPublicCatalog, isShopPubliclyVisible } from '../../../../../lib/products/publicCatalog';
import type { Product, Shop } from '../../../../../lib/core/types';
import { getConvexShopCatalog } from '../../../../../lib/products/convexCatalog';
import { convexOnly } from '../../../../../lib/core/env';

/**
 * Public, read-only catalog feed for a single shop.
 *
 * Purpose: let a seller mirror their own Fewya listings on their own site
 * (octopuscontrol.com is the first consumer) without ever handing out database
 * credentials. Anonymous and cacheable — it only returns data that is already
 * rendered on the public shop and product pages.
 */

const CACHE_SECONDS = 300;

function jsonResponse(payload: unknown, status: number, cacheable: boolean) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': cacheable
                ? `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
                : 'no-store',
            // Read-only public data: allow any origin so a static site can fetch
            // it from the browser as well as at build time.
            'Access-Control-Allow-Origin': '*',
        },
    });
}

export const GET: APIRoute = async ({ params, url }) => {
    const shopSlug = params.shopSlug;
    if (!shopSlug) return jsonResponse({ error: 'shop_not_found' }, 404, false);

    const origin = (APP_BASE_URL ?? new URL(url).origin).replace(/\/+$/, '');
    const convexCatalog = await getConvexShopCatalog(shopSlug);
    if (convexCatalog) {
        const catalog = buildPublicCatalog(convexCatalog.shop, convexCatalog.products, origin);
        return jsonResponse(catalog, 200, true);
    }

    if (convexOnly) return jsonResponse({ error: 'shop_not_found' }, 404, false);

    const { data: shopData } = await supabase
        .from('shops')
        .select('id, slug, name, is_active, status, payments_active, seller_details_complete')
        .eq('slug', shopSlug)
        .eq('is_active', true)
        .eq('status', SHOP_STATUS.ACTIVE)
        .maybeSingle();

    // A shop that exists but cannot sell is indistinguishable from a missing
    // one here on purpose: the feed must not leak onboarding state.
    if (!isShopPubliclyVisible(shopData as Shop | null)) {
        return jsonResponse({ error: 'shop_not_found' }, 404, false);
    }
    const shop = shopData as Shop;

    const { data: productsData, error } = await supabase
        .from('products')
        .select('id, slug, title, description, category, brand, gallery_images, specifications, is_active, created_at, variants:product_variants(price, stock, is_default, weight_kg, length_cm, width_cm, height_cm, shipping_cost)')
        .eq('shop_id', shop.id)
        .eq('is_active', true);

    if (error) return jsonResponse({ error: 'catalog_unavailable' }, 502, false);

    // Product URLs must be the canonical public ones, not whatever host the
    // request happened to hit (preview domains, workers.dev, custom proxies).
    const catalog = buildPublicCatalog(shop, (productsData ?? []) as unknown as Product[], origin);

    return jsonResponse(catalog, 200, true);
};

export const OPTIONS: APIRoute = () =>
    new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Max-Age': '86400',
        },
    });
