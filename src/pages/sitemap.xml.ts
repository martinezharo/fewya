import type { APIRoute } from 'astro';
import { createSupabaseAdminClient } from '../lib/core/supabase-admin';

interface SitemapEntry {
    loc: string;
    lastmod?: string;
    changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
    priority?: number;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function renderSitemap(entries: SitemapEntry[]): string {
    const urls = entries
        .map((entry) => {
            const parts = [`    <loc>${xmlEscape(entry.loc)}</loc>`];
            if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
            if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
            if (entry.priority != null) parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
            return `  <url>\n${parts.join('\n')}\n  </url>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const GET: APIRoute = async ({ url }) => {
    const origin = `${url.protocol}//${url.host}`;
    const entries: SitemapEntry[] = [
        { loc: `${origin}/`, changefreq: 'daily', priority: 1.0 },
        { loc: `${origin}/search`, changefreq: 'daily', priority: 0.8 },
        { loc: `${origin}/login`, changefreq: 'monthly', priority: 0.3 },
    ];

    try {
        const admin = createSupabaseAdminClient();
        const [shopsRes, productsRes] = await Promise.all([
            admin
                .from('shops')
                .select('slug, created_at')
                .eq('is_active', true)
                .limit(5000),
            admin
                .from('products')
                .select('slug, created_at, shops!inner(slug, is_active)')
                .eq('is_active', true)
                .limit(20000),
        ]);

        for (const shop of shopsRes.data ?? []) {
            entries.push({
                loc: `${origin}/${shop.slug}`,
                lastmod: shop.created_at ? new Date(shop.created_at).toISOString().slice(0, 10) : undefined,
                changefreq: 'weekly',
                priority: 0.7,
            });
        }

        for (const product of productsRes.data ?? []) {
            const shop = Array.isArray(product.shops) ? product.shops[0] : product.shops;
            if (!shop?.is_active || !shop.slug) continue;
            entries.push({
                loc: `${origin}/${shop.slug}/${product.slug}`,
                lastmod: product.created_at ? new Date(product.created_at).toISOString().slice(0, 10) : undefined,
                changefreq: 'weekly',
                priority: 0.6,
            });
        }
    } catch (err) {
        console.error(JSON.stringify({
            event: 'sitemap.fetch_failed',
            error: err instanceof Error ? err.message : String(err),
        }));
    }

    return new Response(renderSitemap(entries), {
        status: 200,
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
};
