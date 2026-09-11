import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';

import { validateProductCompleteness } from '../../../../lib/products/productValidation';
import type { Strings } from '../../../../lib/core/i18n';
import type { Locale } from '../../../../lib/core/i18n/locales';
import { enforceVariantPricing, type PricingCheckVariant } from '../../../../lib/products/pricingEnforcement';
import {
    InvalidFieldError,
    optionalNumber,
    optionalStringArray,
    optionalText,
    requiredText,
} from '../../../../lib/core/requestFields';

/**
 * A variant as the seller form posts it: euros, snake_case, and `null` for
 * every value the seller has not filled in yet. The loss-protection check
 * consumes this shape directly, so the payload is normalized once and then
 * converted to Convex's cents-based input.
 */
interface NormalizedVariant extends PricingCheckVariant {
    id?: string;
    stock: number;
    is_default: boolean;
    variant_image: string | null;
}

/** The product payload after validation; absent keys mean "leave unchanged". */
interface NormalizedProduct {
    title?: string;
    slug?: string;
    description?: string | null;
    category?: string;
    brand?: string | null;
    specifications?: Record<string, unknown>;
    gallery_images?: string[];
    is_active?: boolean;
    variants?: NormalizedVariant[];
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}

function optionalBoolean(field: string, value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') throw new InvalidFieldError(field);
    return value;
}

function normalizeVariants(value: unknown): NormalizedVariant[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) throw new InvalidFieldError('variants');
    return value.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null) throw new InvalidFieldError(`variants[${index}]`);
        const variant = entry as Record<string, unknown>;
        const at = (field: string) => `variants[${index}].${field}`;
        return {
            id: variant.id == null ? undefined : requiredText(at('id'), variant.id),
            variant_name: optionalText(at('variant_name'), variant.variant_name) ?? null,
            price: optionalNumber(at('price'), variant.price) ?? 0,
            stock: optionalNumber(at('stock'), variant.stock) ?? 0,
            is_default: optionalBoolean(at('is_default'), variant.is_default) ?? index === 0,
            variant_image: optionalText(at('variant_image'), variant.variant_image) ?? null,
            weight_kg: optionalNumber(at('weight_kg'), variant.weight_kg),
            length_cm: optionalNumber(at('length_cm'), variant.length_cm),
            width_cm: optionalNumber(at('width_cm'), variant.width_cm),
            height_cm: optionalNumber(at('height_cm'), variant.height_cm),
            shipping_cost: optionalNumber(at('shipping_cost'), variant.shipping_cost),
        };
    });
}

/**
 * Validates a request body, whether it creates a product or patches one.
 *
 * `required` is what a creation must carry; on a PATCH every key is optional,
 * but one that is present still has to be usable — an empty title would blank
 * the listing rather than leave it alone.
 */
function normalizeProduct(body: unknown, options: { required: boolean }): NormalizedProduct {
    if (typeof body !== 'object' || body === null) throw new InvalidFieldError('body');
    const raw = body as Record<string, unknown>;
    const specifications = raw.specifications;
    if (specifications !== undefined && specifications !== null
        && (typeof specifications !== 'object' || Array.isArray(specifications))) {
        throw new InvalidFieldError('specifications');
    }

    const title = options.required || raw.title !== undefined ? requiredText('title', raw.title) : undefined;
    const category = options.required || raw.category !== undefined ? requiredText('category', raw.category) : undefined;
    const slug = optionalText('slug', raw.slug);

    return {
        title,
        // A creation always stores a slug; a patch only touches it when asked.
        slug: slug ?? (options.required && title ? slugify(title) : undefined),
        description: optionalText('description', raw.description),
        category,
        brand: optionalText('brand', raw.brand),
        specifications: specifications == null ? undefined : specifications as Record<string, unknown>,
        gallery_images: optionalStringArray('gallery_images', raw.gallery_images),
        is_active: optionalBoolean('is_active', raw.is_active),
        variants: normalizeVariants(raw.variants),
    };
}

function toConvexVariants(variants: NormalizedVariant[]) {
    return variants.map((variant) => ({
        id: variant.id,
        variantName: variant.variant_name ?? null,
        priceCents: Math.round((variant.price ?? 0) * 100),
        stock: variant.stock,
        isDefault: variant.is_default,
        variantImage: variant.variant_image,
        weightKg: variant.weight_kg ?? null,
        lengthCm: variant.length_cm ?? null,
        widthCm: variant.width_cm ?? null,
        heightCm: variant.height_cm ?? null,
        shippingCostCents: variant.shipping_cost == null ? null : Math.round(variant.shipping_cost * 100),
    }));
}

/**
 * Turns a rejected payload into a 400. The two fields the seller form can
 * realistically get wrong get their own message; anything else is a malformed
 * request that no seller should ever produce, so it is logged and answered
 * generically.
 */
function badRequest(error: unknown, t: Strings): Response {
    const field = error instanceof InvalidFieldError ? error.field : 'body';
    if (field === 'title') return new Response(JSON.stringify({ error: t.sellerProductTitleRequired }), { status: 400 });
    if (field === 'category') return new Response(JSON.stringify({ error: t.sellerProductCategoryRequired }), { status: 400 });
    console.error(JSON.stringify({ event: 'seller_product.invalid_body', field }));
    return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
}

function convexError(error: unknown, t: Strings): Response {
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

    let body: NormalizedProduct;
    try {
        body = normalizeProduct(await request.json(), { required: true });
    } catch (error) {
        return badRequest(error, t);
    }

    const completeness = validateProductCompleteness(body, body.variants ?? []);
    if (!completeness.complete) return new Response(JSON.stringify({ error: t.sellerProductIncompleteError.replace('{fields}', completeness.missing.join(', ')) }), { status: 400 });
    try {
        const rejected = await pricingRejection({
            convex,
            t,
            locale,
            variants: body.variants ?? [],
            requestedActive: body.is_active !== false,
        });
        if (rejected) return rejected;

        const result = await convex.mutation(api.seller.createProduct, {
            title: body.title!,
            slug: body.slug!,
            description: body.description ?? null,
            category: body.category!,
            brand: body.brand ?? null,
            specifications: body.specifications ?? {},
            galleryImages: body.gallery_images ?? [],
            isActive: body.is_active !== false,
            variants: toConvexVariants(body.variants ?? []),
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

    let body: NormalizedProduct;
    try {
        body = normalizeProduct(await request.json(), { required: false });
    } catch (error) {
        return badRequest(error, t);
    }

    try {
        if (body.variants !== undefined) {
            const rejected = await pricingRejection({
                convex,
                t,
                locale,
                variants: body.variants,
                // Undefined means "leave publication as it is", so the stored
                // value decides whether the check applies.
                requestedActive: body.is_active,
                productId,
            });
            if (rejected) return rejected;
        }

        const result = await convex.mutation(api.seller.updateProduct, {
            productId,
            title: body.title,
            slug: body.slug,
            description: body.description,
            category: body.category,
            brand: body.brand,
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
