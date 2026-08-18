import { query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';

const sortOption = v.union(
    v.literal('relevance'),
    v.literal('alpha'),
    v.literal('price'),
    v.literal('date'),
);

const sortDirection = v.union(v.literal('asc'), v.literal('desc'));

type ShopDoc = Doc<'shops'>;
type ProductDoc = Doc<'products'>;
type VariantDoc = Doc<'productVariants'>;

function isPublicShop(shop: ShopDoc | null): shop is ShopDoc {
    return Boolean(
        shop &&
        shop.isActive &&
        shop.status === 'active' &&
        shop.paymentsActive &&
        shop.sellerDetailsComplete,
    );
}

function productIsComplete(product: ProductDoc, variants: VariantDoc[]): boolean {
    if (!product.title.trim() || !product.description?.trim() || !product.category.trim()) return false;
    if (!product.slug.trim() || product.galleryImages.length === 0 || variants.length === 0) return false;
    return variants.every((variant) =>
        variant.priceCents > 0 &&
        variant.stock >= 0 &&
        (variant.weightKg ?? 0) > 0 &&
        (variant.lengthCm ?? 0) > 0 &&
        (variant.widthCm ?? 0) > 0 &&
        (variant.heightCm ?? 0) > 0 &&
        (variant.shippingCostCents ?? -1) >= 0,
    );
}

async function shopByLegacyId(ctx: QueryCtx, legacyId: string | undefined): Promise<ShopDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('shops').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function paymentReadyForShop(ctx: QueryCtx, shop: ShopDoc): Promise<boolean> {
    const account = await ctx.db
        .query('shopPaymentAccounts')
        .withIndex('by_shop_id', (q) => q.eq('shopId', shop._id))
        .unique();
    return Boolean(account?.stripeAccountId && account.chargesEnabled && account.payoutsEnabled && account.detailsSubmitted);
}

function legacyStoragePath(value: string | null | undefined): { bucket: string; path: string } | null {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
        if (!match) return null;
        return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
    } catch {
        return null;
    }
}

export async function storageUrl(ctx: QueryCtx | MutationCtx, value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (value.startsWith('convex-storage:')) {
        const storageId = value.slice('convex-storage:'.length) as Id<'_storage'>;
        return await ctx.storage.getUrl(storageId) ?? value;
    }
    const legacy = legacyStoragePath(value);
    if (!legacy) return value;
    const object = await ctx.db
        .query('storageObjects')
        .withIndex('by_bucket_path', (q) => q.eq('bucket', legacy.bucket).eq('legacyPath', legacy.path))
        .unique();
    if (!object?.storageId) return value;
    return await ctx.storage.getUrl(object.storageId) ?? value;
}

async function serializeShop(ctx: QueryCtx, shop: ShopDoc) {
    return {
        id: shop.legacyId,
        owner_id: shop.ownerLegacyId,
        slug: shop.slug,
        name: shop.name,
        description: shop.description ?? null,
        profile_img: await storageUrl(ctx, shop.profileImg),
        banner_img: await storageUrl(ctx, shop.bannerImg),
        contact_email: shop.contactEmail ?? null,
        whatsapp: shop.whatsapp ?? null,
        is_active: shop.isActive,
        status: shop.status,
        created_at: new Date(shop.createdAt).toISOString(),
        accent_color: shop.accentColor ?? null,
        location: shop.location ?? null,
        default_weight_kg: shop.defaultWeightKg ?? null,
        default_length_cm: shop.defaultLengthCm ?? null,
        default_width_cm: shop.defaultWidthCm ?? null,
        default_height_cm: shop.defaultHeightCm ?? null,
        default_shipping_cost: shop.defaultShippingCostCents == null ? null : shop.defaultShippingCostCents / 100,
        payments_active: shop.paymentsActive,
        seller_details_complete: shop.sellerDetailsComplete,
        allow_loss: shop.allowLoss,
        shipping_carriers: shop.shippingCarriers,
    };
}

async function serializeVariant(ctx: QueryCtx, variant: VariantDoc) {
    return {
        id: variant.legacyId,
        product_id: variant.productLegacyId,
        variant_name: variant.variantName ?? null,
        price: variant.priceCents / 100,
        stock: variant.stock,
        attributes: {},
        variant_image: await storageUrl(ctx, variant.variantImage),
        created_at: new Date(variant.createdAt).toISOString(),
        is_default: variant.isDefault,
        weight_kg: variant.weightKg ?? null,
        length_cm: variant.lengthCm ?? null,
        width_cm: variant.widthCm ?? null,
        height_cm: variant.heightCm ?? null,
        shipping_cost: variant.shippingCostCents == null ? null : variant.shippingCostCents / 100,
    };
}

async function variantsFor(ctx: QueryCtx, product: ProductDoc): Promise<VariantDoc[]> {
    return await ctx.db
        .query('productVariants')
        .withIndex('by_product_id', (q) => q.eq('productId', product._id))
        .collect();
}

async function publicProduct(
    ctx: QueryCtx,
    product: ProductDoc,
    shop: ShopDoc,
    includeShop = true,
) {
    const variants = await variantsFor(ctx, product);
    if (!productIsComplete(product, variants)) return null;

    const reviews = await ctx.db
        .query('reviews')
        .withIndex('by_product_id', (q) => q.eq('productId', product._id))
        .collect();
    const reviewCount = reviews.length;
    const reviewAverage = reviewCount === 0
        ? undefined
        : reviews.reduce((sum: number, review: Doc<'reviews'>) => sum + review.rating, 0) / reviewCount;

    return {
        id: product.legacyId,
        slug: product.slug,
        title: product.title,
        description: product.description ?? null,
        category: product.category,
        gallery_images: await Promise.all(product.galleryImages.map((image) => storageUrl(ctx, image))),
        is_active: product.isActive,
        created_at: new Date(product.createdAt).toISOString(),
        brand: product.brand ?? null,
        specifications: product.specifications,
        shop_id: product.shopLegacyId,
        shop: includeShop ? await serializeShop(ctx, shop) : undefined,
        variants: await Promise.all(variants.map((variant) => serializeVariant(ctx, variant))),
        review_avg: reviewAverage,
        review_count: reviewCount,
    };
}

async function publicReviews(ctx: QueryCtx, product: ProductDoc) {
    const rows = await ctx.db
        .query('reviews')
        .withIndex('by_product_id', (q) => q.eq('productId', product._id))
        .order('desc')
        .collect();
    return await Promise.all(rows.map(async (review) => {
        const profile = review.profileId ? await ctx.db.get(review.profileId) : null;
        return {
            id: review.legacyId,
            product_id: review.productLegacyId,
            profile_id: review.profileLegacyId ?? null,
            rating: review.rating,
            comment: review.comment ?? null,
            seller_reply: review.sellerReply ?? null,
            seller_reply_at: review.sellerReplyAt == null ? null : new Date(review.sellerReplyAt).toISOString(),
            created_at: new Date(review.createdAt).toISOString(),
            is_auto: review.isAuto,
            profile: profile ? {
                full_name: profile.fullName ?? null,
                avatar_url: await storageUrl(ctx, profile.avatarUrl),
            } : undefined,
        };
    }));
}

async function visibleProducts(
    ctx: QueryCtx,
    products: ProductDoc[],
    shopsById?: Map<string, ShopDoc>,
) {
    const result = [];
    for (const product of products) {
        const shop = shopsById?.get(String(product.shopId)) ?? (product.shopId ? await ctx.db.get(product.shopId) : null);
        if (!isPublicShop(shop)) continue;
        const serialized = await publicProduct(ctx, product, shop);
        if (serialized) result.push(serialized);
    }
    return result;
}

/** Public storefront feed, replacing the old products/shops joins. */
export const listHomeProducts = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(Math.floor(args.limit ?? 80), 1), 200);
        const products = await ctx.db
            .query('products')
            .withIndex('by_active_created_at', (q) => q.eq('isActive', true))
            .order('desc')
            .take(Math.min(limit * 4, 200));
        const visible = await visibleProducts(ctx, products);
        return visible.slice(0, limit);
    },
});

export const listPublicShops = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(Math.floor(args.limit ?? 12), 1), 50);
        const shops = await ctx.db
            .query('shops')
            .withIndex('by_status', (q) => q.eq('status', 'active'))
            .order('desc')
            .take(limit);
        const visible = shops.filter(isPublicShop);
        return await Promise.all(visible.map(async (shop) => {
            const serialized = await serializeShop(ctx, shop);
            return { slug: serialized.slug, name: serialized.name, profile_img: serialized.profile_img };
        }));
    },
});

/** Search with the same public filters as the Supabase search_products RPC. */
export const searchProducts = query({
    args: {
        query: v.string(),
        minPrice: v.optional(v.number()),
        maxPrice: v.optional(v.number()),
        showOos: v.boolean(),
        sort: sortOption,
        dir: sortDirection,
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(Math.floor(args.limit ?? 80), 1), 200);
        const queryText = args.query.trim();
        const candidates = queryText
            ? await ctx.db
                .query('products')
                .withSearchIndex('search_text', (q) => q.search('searchText', queryText).eq('isActive', true))
                .take(200)
            : await ctx.db
                .query('products')
                .withIndex('by_active_created_at', (q) => q.eq('isActive', true))
                .order('desc')
                .take(200);

        const products = await visibleProducts(ctx, candidates);
        const filtered = products.filter((product) => {
            const prices = product.variants?.map((variant) => variant.price) ?? [];
            const minProductPrice = prices.length ? Math.min(...prices) : 0;
            const inStock = product.variants?.some((variant) => variant.stock > 0) ?? false;
            return (
                (args.minPrice == null || minProductPrice >= args.minPrice) &&
                (args.maxPrice == null || minProductPrice <= args.maxPrice) &&
                (args.showOos || inStock)
            );
        });

        if (args.sort !== 'relevance' || !queryText) {
            const direction = args.dir === 'asc' ? 1 : -1;
            filtered.sort((left, right) => {
                if (args.sort === 'alpha') return direction * left.title.localeCompare(right.title, 'es');
                if (args.sort === 'price') {
                    const leftPrice = left.variants?.find((variant) => variant.is_default)?.price ?? left.variants?.[0]?.price ?? 0;
                    const rightPrice = right.variants?.find((variant) => variant.is_default)?.price ?? right.variants?.[0]?.price ?? 0;
                    return direction * (leftPrice - rightPrice);
                }
                return direction * (new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
            });
        }

        return filtered.slice(0, limit);
    },
});

/** Shop page data and its public products, in one server-side query. */
export const getShopCatalog = query({
    args: { slug: v.string() },
    handler: async (ctx, args) => {
        const shop = await ctx.db
            .query('shops')
            .withIndex('by_slug', (q) => q.eq('slug', args.slug))
            .unique();
        if (!isPublicShop(shop)) return null;

        const products = await ctx.db
            .query('products')
            .withIndex('by_shop_id', (q) => q.eq('shopId', shop._id))
            .order('desc')
            .collect();
        const serializedProducts = (await visibleProducts(ctx, products)).filter((product) => product.is_active);
        const ratings = serializedProducts.flatMap((product) =>
            (product.review_avg == null || product.review_count == null)
                ? []
                : Array.from({ length: product.review_count }, () => product.review_avg ?? 0),
        );
        const totalReviews = serializedProducts.reduce((sum, product) => sum + (product.review_count ?? 0), 0);
        const averageRating = totalReviews === 0 ? 0 : ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
        return {
        shop: await serializeShop(ctx, shop),
            products: serializedProducts,
            totalReviews,
            averageRating,
        };
    },
});

/** Product page data, looked up by the stable shop/product slugs. */
export const getProduct = query({
    args: { shopSlug: v.string(), productSlug: v.string() },
    handler: async (ctx, args) => {
        const shop = await ctx.db
            .query('shops')
            .withIndex('by_slug', (q) => q.eq('slug', args.shopSlug))
            .unique();
        if (!isPublicShop(shop)) return null;
        const product = await ctx.db
            .query('products')
            .withIndex('by_shop_slug', (q) => q.eq('shopLegacyId', shop.legacyId).eq('slug', args.productSlug))
            .unique();
        if (!product || !product.isActive) return null;
        const serialized = await publicProduct(ctx, product, shop);
        if (!serialized) return null;
        return { ...serialized, reviews: await publicReviews(ctx, product) };
    },
});

/** Resolve wishlist IDs to public products while preserving the requested order. */
export const getProductsByLegacyIds = query({
    args: { ids: v.array(v.string()) },
    handler: async (ctx, args) => {
        const products = [] as Awaited<ReturnType<typeof publicProduct>>[];
        for (const legacyId of args.ids.slice(0, 200)) {
            const product = await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
            if (!product || !product.isActive) continue;
            const shop = product.shopId ? await ctx.db.get(product.shopId) : await shopByLegacyId(ctx, product.shopLegacyId);
            if (!isPublicShop(shop)) continue;
            const serialized = await publicProduct(ctx, product, shop);
            if (serialized) products.push(serialized);
        }
        return products;
    },
});

/** Cart-only variant data used by freshness, delivery and Sendcloud quoting. */
export const getCartVariants = query({
    args: { ids: v.array(v.string()) },
    handler: async (ctx, args) => {
        const rows = [];
        for (const id of args.ids.slice(0, 100)) {
            const variant = await ctx.db.query('productVariants').withIndex('by_legacy_id', (q) => q.eq('legacyId', id)).unique();
            if (!variant) continue;
            const product = variant.productId ? await ctx.db.get(variant.productId) : await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', variant.productLegacyId)).unique();
            const shop = product?.shopId ? await ctx.db.get(product.shopId) : product ? await shopByLegacyId(ctx, product.shopLegacyId) : null;
            if (!product || !shop) continue;
            rows.push({
                id: variant.legacyId,
                price: variant.priceCents / 100,
                stock: variant.stock,
                variant_name: variant.variantName ?? null,
                variant_image: await storageUrl(ctx, variant.variantImage),
                shipping_cost: variant.shippingCostCents == null ? null : variant.shippingCostCents / 100,
                weight_kg: variant.weightKg ?? null,
                length_cm: variant.lengthCm ?? null,
                width_cm: variant.widthCm ?? null,
                height_cm: variant.heightCm ?? null,
                product: {
                    id: product.legacyId,
                    title: product.title,
                    slug: product.slug,
                    gallery_images: await Promise.all(product.galleryImages.map((image) => storageUrl(ctx, image))),
                    is_active: product.isActive,
                    shop: {
                        id: shop.legacyId,
                        name: shop.name,
                        slug: shop.slug,
                        is_active: shop.isActive,
                        seller_details_complete: shop.sellerDetailsComplete,
                        shipping_carriers: shop.shippingCarriers,
                        payment_ready: await paymentReadyForShop(ctx, shop),
                    },
                },
            });
        }
        return rows;
    },
});

export const sitemapEntries = query({
    args: {},
    handler: async (ctx) => {
        const shops = (await ctx.db.query('shops').withIndex('by_status', (q) => q.eq('status', 'active')).collect())
            .filter(isPublicShop)
            .map((shop) => ({ slug: shop.slug, created_at: new Date(shop.createdAt).toISOString() }));
        const products = [] as Array<{ slug: string; created_at: string; shop: { slug: string; is_active: boolean; payments_active: boolean; seller_details_complete: boolean } }>;
        for (const shop of shops) {
            const shopDoc = await ctx.db.query('shops').withIndex('by_slug', (q) => q.eq('slug', shop.slug)).unique();
            if (!shopDoc) continue;
            const rows = await ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shopDoc._id)).collect();
            for (const product of rows) if (product.isActive) products.push({
                slug: product.slug,
                created_at: new Date(product.createdAt).toISOString(),
                shop: {
                    slug: shopDoc.slug,
                    is_active: shopDoc.isActive,
                    payments_active: shopDoc.paymentsActive,
                    seller_details_complete: shopDoc.sellerDetailsComplete,
                },
            });
        }
        return { shops, products };
    },
});
