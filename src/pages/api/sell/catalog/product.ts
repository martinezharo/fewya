import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { validateProductCompleteness } from '../../../../lib/products/productValidation';
import type { Strings } from '../../../../lib/core/i18n';
import type { Locale } from '../../../../lib/core/i18n/locales';
import { enforceVariantPricing, type PricingCheckVariant } from '../../../../lib/products/pricingEnforcement';

type VariantInput = {
    id?: string;
    variant_name?: string;
    price: number;
    stock: number;
    is_default?: boolean;
    variant_image?: string | null;
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    shipping_cost?: number | null;
};

type ProductPayload = {
    title: string;
    slug?: string;
    description?: string;
    category: string;
    brand?: string;
    specifications?: Record<string, unknown>;
    gallery_images?: string[];
    is_active?: boolean;
    variants?: VariantInput[];
};

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}

function toConvexVariants(variants: VariantInput[] | undefined) {
    return (variants ?? []).map((variant, index) => ({
        id: variant.id,
        variantName: variant.variant_name?.trim() || null,
        priceCents: Math.round(Number(variant.price ?? 0) * 100),
        stock: Number(variant.stock ?? 0),
        isDefault: variant.is_default ?? index === 0,
        variantImage: variant.variant_image ?? null,
        weightKg: variant.weight_kg ?? null,
        lengthCm: variant.length_cm ?? null,
        widthCm: variant.width_cm ?? null,
        heightCm: variant.height_cm ?? null,
        shippingCostCents: variant.shipping_cost == null ? null : Math.round(Number(variant.shipping_cost) * 100),
    }));
}

function convexError(error: unknown, t: any): Response {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('slug already in use')) return new Response(JSON.stringify({ error: t.sellerProductSlugInUse }), { status: 409 });
    if (message.includes('access denied')) return new Response(JSON.stringify({ error: t.apiForbidden }), { status: 403 });
    if (message.includes('has orders')) return new Response(JSON.stringify({ error: t.sellerProductDeleteHasOrders }), { status: 409 });
    console.error(JSON.stringify({ event: 'seller_product.failed', error: message }));
    return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
}

/**
 * Refuses to publish variants that would lose money on shipping, unless the
 * seller explicitly enabled `allow_loss`. The rule needs a live carrier quote,
 * so it runs here rather than inside the Convex mutation.
 *
 * `willBeActive` is what the request leaves the product as: an unpublished
 * draft may be saved at any price, since nobody can buy it.
 */
async function pricingRejection(options: {
    convex: NonNullable<ReturnType<typeof createRequestConvexClient>>;
    t: Strings;
    locale: Locale;
    variants: PricingCheckVariant[];
    requestedActive?: boolean;
    productId?: string;
}): Promise<Response | null> {
    const { convex, t, locale, variants, requestedActive, productId } = options;
    if (variants.length === 0) return null;

    const context = await convex.query(api.seller.pricingContext, productId ? { productId } : {});
    const willBeActive = requestedActive ?? context.isActive;
    if (!willBeActive || context.allowLoss) return null;

    const pricing = await enforceVariantPricing(t, locale, variants);
    if (pricing.ok) return null;
    return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t, locale } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    let body: ProductPayload;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 }); }
    if (!body.title?.trim()) return new Response(JSON.stringify({ error: t.sellerProductTitleRequired }), { status: 400 });
    if (!body.category?.trim()) return new Response(JSON.stringify({ error: t.sellerProductCategoryRequired }), { status: 400 });
    const completeness = validateProductCompleteness(body, body.variants ?? []);
    if (!completeness.complete) return new Response(JSON.stringify({ error: t.sellerProductIncompleteError.replace('{fields}', completeness.missing.join(', ')) }), { status: 400 });
    try {
        const rejected = await pricingRejection({
            convex,
            t,
            locale,
            variants: (body.variants ?? []) as PricingCheckVariant[],
            requestedActive: body.is_active !== false,
        });
        if (rejected) return rejected;

        const result = await convex.mutation(api.seller.createProduct, {
            title: body.title.trim(),
            slug: body.slug?.trim() || slugify(body.title),
            description: body.description?.trim() || null,
            category: body.category.trim(),
            brand: body.brand?.trim() || null,
            specifications: body.specifications ?? {},
            galleryImages: body.gallery_images ?? [],
            isActive: body.is_active !== false,
            variants: toConvexVariants(body.variants),
        });
        return new Response(JSON.stringify({ product: result.product, variants: result.product?.variants ?? [] }), { status: 201 });
    } catch (error) {
        return convexError(error, t);
    }
};

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

    let body: ProductPayload;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 }); }
    if (body.title !== undefined && !body.title?.trim()) return new Response(JSON.stringify({ error: t.sellerProductTitleRequired }), { status: 400 });
    if (body.category !== undefined && !body.category?.trim()) return new Response(JSON.stringify({ error: t.sellerProductCategoryRequired }), { status: 400 });
    try {
        if (body.variants !== undefined) {
            const rejected = await pricingRejection({
                convex,
                t,
                locale,
                variants: body.variants as PricingCheckVariant[],
                // Undefined means "leave publication as it is", so the stored
                // value decides whether the check applies.
                requestedActive: body.is_active,
                productId,
            });
            if (rejected) return rejected;
        }

        const result = await convex.mutation(api.seller.updateProduct, {
            productId,
            title: body.title === undefined ? undefined : body.title.trim(),
            slug: body.slug === undefined ? undefined : body.slug.trim(),
            description: body.description === undefined ? undefined : body.description.trim() || null,
            category: body.category === undefined ? undefined : body.category.trim(),
            brand: body.brand === undefined ? undefined : body.brand.trim() || null,
            specifications: body.specifications,
            galleryImages: body.gallery_images,
            isActive: body.is_active,
            variants: body.variants === undefined ? undefined : toConvexVariants(body.variants),
        });
        return new Response(JSON.stringify({ product: result.product }), { status: 200 });
    } catch (error) {
        return convexError(error, t);
    }
};

export const DELETE: APIRoute = async ({ locals, request, url }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    try {
        await convex.mutation(api.seller.deleteProduct, { productId });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (error) {
        return convexError(error, t);
    }
};
