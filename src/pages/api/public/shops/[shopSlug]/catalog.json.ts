import type { APIRoute } from 'astro';
import { APP_BASE_URL } from 'astro:env/server';
import { buildPublicCatalog } from '../../../../../lib/products/publicCatalog';
import { fetchConvexShopCatalog } from '../../../../../lib/products/convexCatalog';

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

    let catalog;
    try {
        catalog = await fetchConvexShopCatalog(shopSlug);
    } catch (error) {
        // An unreachable backend must not be cached as a missing shop.
        console.error('Public catalog feed unavailable:', error);
        return jsonResponse({ error: 'catalog_unavailable' }, 502, false);
    }

    // A shop that exists but cannot sell is indistinguishable from a missing
    // one here on purpose: the feed must not leak onboarding state.
    if (!catalog) return jsonResponse({ error: 'shop_not_found' }, 404, false);

    // Product URLs must be the canonical public ones, not whatever host the
    // request happened to hit (preview domains, workers.dev, custom proxies).
    return jsonResponse(buildPublicCatalog(catalog.shop, catalog.products, origin), 200, true);
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
