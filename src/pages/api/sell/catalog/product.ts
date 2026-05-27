import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/core/auth';
import { strings } from '../../../../lib/core/i18n';
import { validateProductCompleteness } from '../../../../lib/products/productValidation';
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

export const POST: APIRoute = async ({ cookies, request }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id, allow_loss')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    let body: ProductPayload;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    if (!body.title?.trim()) {
        return new Response(JSON.stringify({ error: strings.sellerProductTitleRequired }), { status: 400 });
    }

    if (!body.category?.trim()) {
        return new Response(JSON.stringify({ error: strings.sellerProductCategoryRequired }), { status: 400 });
    }

    const completeness = validateProductCompleteness(body, body.variants ?? []);
    if (!completeness.complete) {
        const list = completeness.missing.join(', ');
        return new Response(JSON.stringify({ error: strings.sellerProductIncompleteError.replace('{fields}', list) }), { status: 400 });
    }

    const willBeActive = body.is_active !== false;
    if (willBeActive && !shop.allow_loss && body.variants && body.variants.length > 0) {
        const pricing = await enforceVariantPricing(body.variants as PricingCheckVariant[]);
        if (!pricing.ok) {
            return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
        }
    }

    const slug = body.slug?.trim() || slugify(body.title);

    const { data: slugCheck } = await supabase
        .from('products')
        .select('id')
        .eq('shop_id', shop.id)
        .eq('slug', slug)
        .maybeSingle();

    if (slugCheck) {
        return new Response(JSON.stringify({ error: strings.sellerProductSlugInUse }), { status: 409 });
    }

    const { data: product, error: productError } = await supabase
        .from('products')
        .insert({
            shop_id: shop.id,
            title: body.title.trim(),
            slug,
            description: body.description?.trim() || null,
            category: body.category,
            brand: body.brand?.trim() || null,
            specifications: body.specifications || {},
            gallery_images: body.gallery_images || [],
            is_active: body.is_active !== false,
        })
        .select()
        .single();

    if (productError) {
        if ((productError as { code?: string }).code === '23505') {
            return new Response(JSON.stringify({ error: strings.sellerProductSlugInUse }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: productError.message }), { status: 500 });
    }

    const { data: triggerVariant } = await supabase
        .from('product_variants')
        .select('id')
        .eq('product_id', product.id)
        .eq('is_default', true)
        .maybeSingle();

    const variants = body.variants || [];
    const variantResults = [];

    if (variants.length > 0) {
        if (triggerVariant?.id) {
            const first = variants[0];
            const { data: updated, error: updErr } = await supabase
                .from('product_variants')
                .update({
                    variant_name: first.variant_name?.trim() || null,
                    price: first.price,
                    stock: first.stock ?? 0,
                    is_default: true,
                    variant_image: first.variant_image || null,
                    weight_kg: first.weight_kg ?? null,
                    length_cm: first.length_cm ?? null,
                    width_cm: first.width_cm ?? null,
                    height_cm: first.height_cm ?? null,
                    shipping_cost: first.shipping_cost ?? null,
                })
                .eq('id', triggerVariant.id)
                .select()
                .single();

            if (updErr) {
                return new Response(JSON.stringify({ error: updErr.message }), { status: 500 });
            }
            variantResults.push(updated);
        }

        for (let i = triggerVariant?.id ? 1 : 0; i < variants.length; i++) {
            const v = variants[i];
            const { data: inserted, error: insErr } = await supabase
                .from('product_variants')
                .insert({
                    product_id: product.id,
                    variant_name: v.variant_name?.trim() || null,
                    price: v.price,
                    stock: v.stock ?? 0,
                    is_default: false,
                    variant_image: v.variant_image || null,
                    weight_kg: v.weight_kg ?? null,
                    length_cm: v.length_cm ?? null,
                    width_cm: v.width_cm ?? null,
                    height_cm: v.height_cm ?? null,
                    shipping_cost: v.shipping_cost ?? null,
                })
                .select()
                .single();

            if (insErr) {
                return new Response(JSON.stringify({ error: insErr.message }), { status: 500 });
            }
            variantResults.push(inserted);
        }

        if (!triggerVariant?.id && variants.length === 0) {
            // trigger will create one, do nothing
        }
    } else if (triggerVariant?.id) {
        variantResults.push(triggerVariant);
    }

    return new Response(JSON.stringify({ product, variants: variantResults }), { status: 201 });
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id, allow_loss')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    const { data: existing } = await supabase
        .from('products')
        .select('id, slug, is_active')
        .eq('id', productId)
        .eq('shop_id', shop.id)
        .maybeSingle();

    if (!existing) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    let body: ProductPayload;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    if (body.title !== undefined && !body.title?.trim()) {
        return new Response(JSON.stringify({ error: strings.sellerProductTitleRequired }), { status: 400 });
    }

    if (body.category !== undefined && !body.category?.trim()) {
        return new Response(JSON.stringify({ error: strings.sellerProductCategoryRequired }), { status: 400 });
    }

    // Validate completeness when relevant fields are being updated
    if (body.variants !== undefined || body.title !== undefined || body.description !== undefined || body.category !== undefined || body.gallery_images !== undefined) {
        const { data: existingProduct } = await supabase
            .from('products')
            .select('title, description, category, slug, gallery_images')
            .eq('id', productId)
            .single();

        const mergedProduct = {
            title: body.title ?? existingProduct?.title ?? '',
            description: body.description !== undefined ? body.description : (existingProduct?.description ?? ''),
            category: body.category ?? existingProduct?.category ?? '',
            slug: body.slug !== undefined ? body.slug : (existingProduct?.slug ?? ''),
            gallery_images: body.gallery_images ?? existingProduct?.gallery_images ?? [],
        };

        const variantsForCheck = body.variants ?? [];
        if (variantsForCheck.length > 0) {
            const completeness = validateProductCompleteness(mergedProduct, variantsForCheck);
            if (!completeness.complete) {
                const list = completeness.missing.join(', ');
                return new Response(JSON.stringify({ error: strings.sellerProductIncompleteError.replace('{fields}', list) }), { status: 400 });
            }
        }
    }

    const willBeActive = body.is_active === undefined ? existing.is_active : body.is_active;
    if (willBeActive && !shop.allow_loss && body.variants && body.variants.length > 0) {
        const pricing = await enforceVariantPricing(body.variants as PricingCheckVariant[]);
        if (!pricing.ok) {
            return new Response(JSON.stringify({ error: pricing.errors.join('\n') }), { status: 400 });
        }
    }

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.slug !== undefined) {
        const newSlug = body.slug.trim() || (body.title ? slugify(body.title) : existing.slug);
        if (newSlug !== existing.slug) {
            const { data: slugCheck } = await supabase
                .from('products')
                .select('id')
                .eq('shop_id', shop.id)
                .eq('slug', newSlug)
                .maybeSingle();
            if (slugCheck) {
                return new Response(JSON.stringify({ error: strings.sellerProductSlugInUse }), { status: 409 });
            }
        }
        updates.slug = newSlug;
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.category !== undefined) updates.category = body.category;
    if (body.brand !== undefined) updates.brand = body.brand?.trim() || null;
    if (body.specifications !== undefined) updates.specifications = body.specifications;
    if (body.gallery_images !== undefined) updates.gallery_images = body.gallery_images;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase
            .from('products')
            .update(updates)
            .eq('id', productId);

        if (updErr) {
            return new Response(JSON.stringify({ error: updErr.message }), { status: 500 });
        }
    }

    if (body.variants !== undefined) {
        const { data: currentVariants } = await supabase
            .from('product_variants')
            .select('id')
            .eq('product_id', productId);

        const currentIds = new Set((currentVariants || []).map((v: any) => v.id));
        const incomingIds = new Set<string>();

        for (const v of body.variants) {
            if (v.id) {
                incomingIds.add(v.id);
                const { error } = await supabase
                    .from('product_variants')
                    .update({
                        variant_name: v.variant_name?.trim() || null,
                        price: v.price,
                        stock: v.stock ?? 0,
                        is_default: v.is_default ?? false,
                        variant_image: v.variant_image || null,
                        weight_kg: v.weight_kg ?? null,
                        length_cm: v.length_cm ?? null,
                        width_cm: v.width_cm ?? null,
                        height_cm: v.height_cm ?? null,
                        shipping_cost: v.shipping_cost ?? null,
                    })
                    .eq('id', v.id)
                    .eq('product_id', productId);

                if (error) {
                    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
                }
            } else {
                const { error } = await supabase
                    .from('product_variants')
                    .insert({
                        product_id: productId,
                        variant_name: v.variant_name?.trim() || null,
                        price: v.price,
                        stock: v.stock ?? 0,
                        is_default: v.is_default ?? false,
                        variant_image: v.variant_image || null,
                        weight_kg: v.weight_kg ?? null,
                        length_cm: v.length_cm ?? null,
                        width_cm: v.width_cm ?? null,
                        height_cm: v.height_cm ?? null,
                        shipping_cost: v.shipping_cost ?? null,
                    });

                if (error) {
                    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
                }
            }
        }

        for (const cid of currentIds) {
            if (!incomingIds.has(cid)) {
                await supabase
                    .from('product_variants')
                    .delete()
                    .eq('id', cid);
            }
        }
    }

    const { data: product } = await supabase
        .from('products')
        .select('*, variants:product_variants(*)')
        .eq('id', productId)
        .single();

    return new Response(JSON.stringify({ product }), { status: 200 });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: strings.apiUnauthorized }), { status: 401 });
    }

    const productId = url.searchParams.get('id');
    if (!productId) {
        return new Response(JSON.stringify({ error: strings.apiInvalidBody }), { status: 400 });
    }

    const { data: shop } = await supabase
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

    if (!shop) {
        return new Response(JSON.stringify({ error: strings.apiForbidden }), { status: 403 });
    }

    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId)
        .eq('shop_id', shop.id);

    if (error) {
        if (error.code === '23503') {
            return new Response(JSON.stringify({ error: strings.sellerProductDeleteHasOrders }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
};