import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';
import { storageUrl } from './catalog';

type ReadCtx = QueryCtx | MutationCtx;
type ShopDoc = Doc<'shops'>;
type ProductDoc = Doc<'products'>;

const optionalString = v.optional(v.union(v.string(), v.null()));
const optionalNumber = v.optional(v.union(v.number(), v.null()));

const variantInput = v.object({
    id: v.optional(v.string()),
    variantName: v.optional(v.union(v.string(), v.null())),
    priceCents: v.number(),
    stock: v.number(),
    isDefault: v.optional(v.boolean()),
    variantImage: optionalString,
    weightKg: optionalNumber,
    lengthCm: optionalNumber,
    widthCm: optionalNumber,
    heightCm: optionalNumber,
    shippingCostCents: optionalNumber,
});

async function shopForProfile(ctx: ReadCtx, profile: Doc<'profiles'>): Promise<ShopDoc | null> {
    const byId = await ctx.db.query('shops').withIndex('by_owner_id', (q) => q.eq('ownerId', profile._id)).unique();
    if (byId) return byId;
    return await ctx.db.query('shops').withIndex('by_owner_legacy_id', (q) => q.eq('ownerLegacyId', profile.legacyId)).unique();
}

async function sellerContext(ctx: ReadCtx) {
    const user = await identity(ctx);
    const profile = await profileForIdentity(ctx, user);
    if (!profile?.isSeller) throw new Error('Seller access required');
    const shop = await shopForProfile(ctx, profile);
    if (!shop) throw new Error('Shop not found');
    return { user, profile, shop };
}

function productIsComplete(product: ProductDoc, variants: Array<Doc<'productVariants'>>): boolean {
    return Boolean(
        product.title.trim() && product.description?.trim() && product.category.trim() && product.slug.trim()
        && product.galleryImages.length > 0 && variants.length > 0
        && variants.every((variant) => variant.priceCents > 0 && variant.stock >= 0
            && (variant.weightKg ?? 0) > 0 && (variant.lengthCm ?? 0) > 0
            && (variant.widthCm ?? 0) > 0 && (variant.heightCm ?? 0) > 0
            && (variant.shippingCostCents ?? -1) >= 0),
    );
}

async function serializeProduct(ctx: ReadCtx, product: ProductDoc) {
    const variants = await ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect();
    return {
        id: product.legacyId,
        shop_id: product.shopLegacyId,
        title: product.title,
        slug: product.slug,
        description: product.description ?? null,
        category: product.category,
        brand: product.brand ?? null,
        specifications: product.specifications,
        gallery_images: await Promise.all(product.galleryImages.map((image) => storageUrl(ctx, image))),
        is_active: product.isActive,
        created_at: new Date(product.createdAt).toISOString(),
        isComplete: productIsComplete(product, variants),
        variants: await Promise.all(variants.map(async (variant) => ({
            id: variant.legacyId,
            product_id: variant.productLegacyId,
            variant_name: variant.variantName ?? null,
            price: variant.priceCents / 100,
            stock: variant.stock,
            variant_image: await storageUrl(ctx, variant.variantImage),
            created_at: new Date(variant.createdAt).toISOString(),
            is_default: variant.isDefault,
            weight_kg: variant.weightKg ?? null,
            length_cm: variant.lengthCm ?? null,
            width_cm: variant.widthCm ?? null,
            height_cm: variant.heightCm ?? null,
            shipping_cost: variant.shippingCostCents == null ? null : variant.shippingCostCents / 100,
            attributes: {},
        }))),
    };
}

async function serializeShop(ctx: ReadCtx, shop: ShopDoc) {
    return {
        id: shop.legacyId,
        owner_id: shop.ownerLegacyId,
        name: shop.name,
        slug: shop.slug,
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

export const current = query({
    args: {},
    handler: async (ctx) => {
        const { profile, shop } = await sellerContext(ctx);
        const [products, paymentAccount, orders] = await Promise.all([
            ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).order('desc').collect(),
            ctx.db.query('shopPaymentAccounts').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).unique(),
            ctx.db.query('orders').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect(),
        ]);
        return {
            profile: {
                id: profile.legacyId,
                is_seller: profile.isSeller,
                first_name: profile.firstName ?? null,
                last_name: profile.lastName ?? null,
                email: profile.email,
                phone: profile.phone ?? null,
                phone_prefix: profile.phonePrefix ?? null,
                address_street: profile.addressStreet ?? null,
                address_number: profile.addressNumber ?? null,
                address_floor: profile.addressFloor ?? null,
                address_postal_code: profile.addressPostalCode ?? null,
                address_city: profile.addressCity ?? null,
                address_province: profile.addressProvince ?? null,
                address_country: profile.addressCountry ?? null,
            },
            shop: await serializeShop(ctx, shop),
            paymentAccount: paymentAccount ? {
                stripe_account_id: paymentAccount.stripeAccountId,
                charges_enabled: paymentAccount.chargesEnabled,
                payouts_enabled: paymentAccount.payoutsEnabled,
                details_submitted: paymentAccount.detailsSubmitted,
                onboarding_completed_at: paymentAccount.onboardingCompletedAt == null ? null : new Date(paymentAccount.onboardingCompletedAt).toISOString(),
            } : null,
            products: await Promise.all(products.map((product) => serializeProduct(ctx, product))),
            metrics: {
                activeIncidents: orders.filter((order) => order.status === 'incident').length,
                pendingOrders: orders.filter((order) => order.status === 'paid' || order.status === 'processing').length,
                deliveryFailed: orders.filter((order) => order.status === 'delivery_failed').length,
            },
        };
    },
});

/** Seller onboarding context; unlike `current`, this also works before a shop
 * exists and therefore before the profile has been marked as a seller. */
export const onboarding = query({
    args: {},
    handler: async (ctx) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) return null;
        const shop = await shopForProfile(ctx, profile);
        const paymentAccount = shop ? await ctx.db.query('shopPaymentAccounts').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).unique() : null;
        return {
            profile: {
                id: profile.legacyId,
                is_seller: profile.isSeller,
                email: profile.email,
                avatar_url: profile.avatarUrl ?? null,
            },
            shop: shop ? await serializeShop(ctx, shop) : null,
            paymentAccount: paymentAccount ? {
                stripe_account_id: paymentAccount.stripeAccountId,
                charges_enabled: paymentAccount.chargesEnabled,
                payouts_enabled: paymentAccount.payoutsEnabled,
                details_submitted: paymentAccount.detailsSubmitted,
                onboarding_completed_at: paymentAccount.onboardingCompletedAt == null ? null : new Date(paymentAccount.onboardingCompletedAt).toISOString(),
            } : null,
        };
    },
});

export const product = query({
    args: { productId: v.string() },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const product = await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', args.productId)).unique();
        if (!product || product.shopId !== shop._id && product.shopLegacyId !== shop.legacyId) return null;
        return { shop: await serializeShop(ctx, shop), product: await serializeProduct(ctx, product) };
    },
});

export const updateShop = mutation({
    args: {
        name: optionalString,
        slug: optionalString,
        description: optionalString,
        accentColor: optionalString,
        contactEmail: optionalString,
        whatsapp: optionalString,
        location: optionalString,
        profileImg: optionalString,
        bannerImg: optionalString,
    },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        if (args.slug !== undefined && args.slug !== shop.slug) {
            const existing = await ctx.db.query('shops').withIndex('by_slug', (q) => q.eq('slug', args.slug!)).unique();
            if (existing && existing._id !== shop._id) throw new Error('Shop slug already in use');
        }
        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) patch.name = args.name;
        if (args.slug !== undefined) patch.slug = args.slug;
        if (args.description !== undefined) patch.description = args.description;
        if (args.accentColor !== undefined) patch.accentColor = args.accentColor;
        if (args.contactEmail !== undefined) patch.contactEmail = args.contactEmail;
        if (args.whatsapp !== undefined) patch.whatsapp = args.whatsapp;
        if (args.location !== undefined) patch.location = args.location;
        if (args.profileImg !== undefined) patch.profileImg = args.profileImg;
        if (args.bannerImg !== undefined) patch.bannerImg = args.bannerImg;
        if (Object.keys(patch).length) await ctx.db.patch(shop._id, patch as never);
        return { shopId: shop.legacyId };
    },
});

export const updateShipping = mutation({
    args: {
        defaultWeightKg: optionalNumber,
        defaultLengthCm: optionalNumber,
        defaultWidthCm: optionalNumber,
        defaultHeightCm: optionalNumber,
        defaultShippingCostCents: optionalNumber,
        shippingCarriers: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        await ctx.db.patch(shop._id, {
            ...(args.defaultWeightKg === undefined ? {} : { defaultWeightKg: args.defaultWeightKg == null ? undefined : args.defaultWeightKg }),
            ...(args.defaultLengthCm === undefined ? {} : { defaultLengthCm: args.defaultLengthCm == null ? undefined : args.defaultLengthCm }),
            ...(args.defaultWidthCm === undefined ? {} : { defaultWidthCm: args.defaultWidthCm == null ? undefined : args.defaultWidthCm }),
            ...(args.defaultHeightCm === undefined ? {} : { defaultHeightCm: args.defaultHeightCm == null ? undefined : args.defaultHeightCm }),
            ...(args.defaultShippingCostCents === undefined ? {} : { defaultShippingCostCents: args.defaultShippingCostCents == null ? undefined : args.defaultShippingCostCents }),
            ...(args.shippingCarriers === undefined ? {} : { shippingCarriers: args.shippingCarriers }),
        });
        return { ok: true };
    },
});

export const deleteShop = mutation({
    args: {},
    handler: async (ctx) => {
        const { profile, shop } = await sellerContext(ctx);
        await ctx.db.patch(shop._id, { status: 'inactive', isActive: false, paymentsActive: false });
        const products = await ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect();
        for (const product of products) await ctx.db.patch(product._id, { isActive: false });
        await ctx.db.patch(profile._id, { isSeller: false });
        return { ok: true };
    },
});

function normalizeSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export const createShop = mutation({
    args: {
        name: v.string(),
        slug: v.string(),
        description: optionalString,
        profileImg: optionalString,
        bannerImg: optionalString,
        accentColor: optionalString,
        contactEmail: optionalString,
        whatsapp: optionalString,
        location: optionalString,
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');
        const existing = await shopForProfile(ctx, profile);
        if (existing) return { shopId: existing.legacyId, created: false };
        const slug = normalizeSlug(args.slug);
        const slugExisting = await ctx.db.query('shops').withIndex('by_slug', (q) => q.eq('slug', slug)).unique();
        if (slugExisting) throw new Error('Shop slug already in use');
        const id = await ctx.db.insert('shops', {
            legacyId: `convex:shop:${crypto.randomUUID()}`,
            ownerId: profile._id,
            ownerLegacyId: profile.legacyId,
            name: args.name.trim(),
            slug,
            description: args.description ?? undefined,
            profileImg: args.profileImg ?? undefined,
            bannerImg: args.bannerImg ?? undefined,
            contactEmail: args.contactEmail ?? profile.email,
            whatsapp: args.whatsapp ?? undefined,
            location: args.location ?? undefined,
            isActive: true,
            status: 'active',
            createdAt: Date.now(),
            accentColor: args.accentColor ?? '#000000',
            paymentsActive: false,
            sellerDetailsComplete: false,
            allowLoss: false,
            shippingCarriers: ['inpost', 'correos'],
        });
        if (!profile.isSeller) await ctx.db.patch(profile._id, { isSeller: true });
        return { shopId: String(id), created: true };
    },
});

export const createProduct = mutation({
    args: {
        title: v.string(),
        slug: v.string(),
        description: optionalString,
        category: v.string(),
        brand: optionalString,
        specifications: v.any(),
        galleryImages: v.array(v.string()),
        isActive: v.boolean(),
        variants: v.array(variantInput),
    },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const slug = normalizeSlug(args.slug);
        const duplicate = await ctx.db.query('products').withIndex('by_shop_slug', (q) => q.eq('shopLegacyId', shop.legacyId).eq('slug', slug)).unique();
        if (duplicate) throw new Error('Product slug already in use');
        const legacyProductId = `convex:product:${crypto.randomUUID()}`;
        const productId = await ctx.db.insert('products', {
            legacyId: legacyProductId,
            shopId: shop._id,
            shopLegacyId: shop.legacyId,
            title: args.title.trim(),
            slug,
            description: args.description ?? undefined,
            category: args.category.trim(),
            brand: args.brand ?? undefined,
            specifications: args.specifications ?? {},
            galleryImages: args.galleryImages,
            isActive: args.isActive,
            createdAt: Date.now(),
            searchText: `${args.title} ${args.description ?? ''} ${args.category} ${args.brand ?? ''}`.trim(),
        });
        for (let index = 0; index < args.variants.length; index++) {
            const variant = args.variants[index];
            await ctx.db.insert('productVariants', {
                legacyId: `convex:variant:${crypto.randomUUID()}`,
                productId,
                productLegacyId: legacyProductId,
                variantName: variant.variantName ?? undefined,
                priceCents: variant.priceCents,
                stock: variant.stock,
                variantImage: variant.variantImage ?? undefined,
                createdAt: Date.now(),
                isDefault: variant.isDefault ?? index === 0,
                weightKg: variant.weightKg ?? undefined,
                lengthCm: variant.lengthCm ?? undefined,
                widthCm: variant.widthCm ?? undefined,
                heightCm: variant.heightCm ?? undefined,
                shippingCostCents: variant.shippingCostCents ?? undefined,
            });
        }
        const product = await ctx.db.get(productId);
        return { product: product ? await serializeProduct(ctx, product) : null };
    },
});

export const updateProduct = mutation({
    args: {
        productId: v.string(),
        title: optionalString,
        slug: optionalString,
        description: optionalString,
        category: optionalString,
        brand: optionalString,
        specifications: v.optional(v.any()),
        galleryImages: v.optional(v.array(v.string())),
        isActive: v.optional(v.boolean()),
        variants: v.optional(v.array(variantInput)),
    },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const product = await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', args.productId)).unique();
        if (!product || (product.shopId !== shop._id && product.shopLegacyId !== shop.legacyId)) throw new Error('Product access denied');
        if (args.slug !== undefined && args.slug !== product.slug) {
            const slug = normalizeSlug(args.slug ?? '');
            const duplicate = await ctx.db.query('products').withIndex('by_shop_slug', (q) => q.eq('shopLegacyId', shop.legacyId).eq('slug', slug)).unique();
            if (duplicate && duplicate._id !== product._id) throw new Error('Product slug already in use');
        }
        const patch: Record<string, unknown> = {};
        if (args.title !== undefined) patch.title = args.title;
        if (args.slug !== undefined) patch.slug = normalizeSlug(args.slug ?? '');
        if (args.description !== undefined) patch.description = args.description;
        if (args.category !== undefined) patch.category = args.category;
        if (args.brand !== undefined) patch.brand = args.brand;
        if (args.specifications !== undefined) patch.specifications = args.specifications;
        if (args.galleryImages !== undefined) patch.galleryImages = args.galleryImages;
        if (args.isActive !== undefined) patch.isActive = args.isActive;
        if (args.title !== undefined || args.description !== undefined || args.category !== undefined || args.brand !== undefined) {
            patch.searchText = `${args.title ?? product.title} ${args.description ?? product.description ?? ''} ${args.category ?? product.category} ${args.brand ?? product.brand ?? ''}`.trim();
        }
        if (Object.keys(patch).length) await ctx.db.patch(product._id, patch as never);

        if (args.variants !== undefined) {
            const current = await ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect();
            const currentByLegacy = new Map(current.map((variant) => [variant.legacyId, variant]));
            const incoming = new Set<string>();
            for (let index = 0; index < args.variants.length; index++) {
                const variant = args.variants[index];
                const existing = variant.id ? currentByLegacy.get(variant.id) : undefined;
                if (existing) {
                    incoming.add(existing.legacyId);
                    await ctx.db.patch(existing._id, {
                        variantName: variant.variantName ?? undefined,
                        priceCents: variant.priceCents,
                        stock: variant.stock,
                        isDefault: variant.isDefault ?? index === 0,
                        variantImage: variant.variantImage ?? undefined,
                        weightKg: variant.weightKg ?? undefined,
                        lengthCm: variant.lengthCm ?? undefined,
                        widthCm: variant.widthCm ?? undefined,
                        heightCm: variant.heightCm ?? undefined,
                        shippingCostCents: variant.shippingCostCents ?? undefined,
                    });
                } else {
                    const legacyId = `convex:variant:${crypto.randomUUID()}`;
                    incoming.add(legacyId);
                    await ctx.db.insert('productVariants', {
                        legacyId,
                        productId: product._id,
                        productLegacyId: product.legacyId,
                        variantName: variant.variantName ?? undefined,
                        priceCents: variant.priceCents,
                        stock: variant.stock,
                        isDefault: variant.isDefault ?? index === 0,
                        variantImage: variant.variantImage ?? undefined,
                        weightKg: variant.weightKg ?? undefined,
                        lengthCm: variant.lengthCm ?? undefined,
                        widthCm: variant.widthCm ?? undefined,
                        heightCm: variant.heightCm ?? undefined,
                        shippingCostCents: variant.shippingCostCents ?? undefined,
                        createdAt: Date.now(),
                    });
                }
            }
            for (const variant of current) if (!incoming.has(variant.legacyId)) await ctx.db.delete(variant._id);
        }
        const updated = await ctx.db.get(product._id);
        return { product: updated ? await serializeProduct(ctx, updated) : null };
    },
});

export const toggleProduct = mutation({
    args: { productId: v.string(), isActive: v.boolean() },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const product = await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', args.productId)).unique();
        if (!product || (product.shopId !== shop._id && product.shopLegacyId !== shop.legacyId)) throw new Error('Product access denied');
        await ctx.db.patch(product._id, { isActive: args.isActive });
        return { product: await serializeProduct(ctx, { ...product, isActive: args.isActive }) };
    },
});

export const deleteProduct = mutation({
    args: { productId: v.string() },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const product = await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', args.productId)).unique();
        if (!product || (product.shopId !== shop._id && product.shopLegacyId !== shop.legacyId)) throw new Error('Product access denied');
        const productVariants = await ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect();
        const variantIds = new Set(productVariants.map((variant) => String(variant._id)));
        const variantLegacyIds = new Set(productVariants.map((variant) => variant.legacyId));
        const orders = (await ctx.db.query('orderItems').collect()).filter((item) =>
            (item.variantId && variantIds.has(String(item.variantId))) ||
            (item.variantLegacyId && variantLegacyIds.has(item.variantLegacyId)),
        );
        if (orders.length > 0) throw new Error('Product has orders');
        const variants = await ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect();
        for (const variant of variants) await ctx.db.delete(variant._id);
        await ctx.db.delete(product._id);
        return { ok: true };
    },
});

export const listReviews = query({
    args: {},
    handler: async (ctx) => {
        const { shop } = await sellerContext(ctx);
        const products = await ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect();
        const productIds = new Set(products.map((product) => String(product._id)));
        const rows = (await ctx.db.query('reviews').order('desc').collect()).filter((review) => review.productId && productIds.has(String(review.productId)));
        return await Promise.all(rows.map(async (review) => {
            const product = review.productId ? await ctx.db.get(review.productId) : null;
            const profile = review.profileId ? await ctx.db.get(review.profileId) : null;
            return {
                id: review.legacyId,
                rating: review.rating,
                comment: review.comment ?? null,
                sellerReply: review.sellerReply ?? null,
                sellerReplyAt: review.sellerReplyAt == null ? null : new Date(review.sellerReplyAt).toISOString(),
                createdAt: new Date(review.createdAt).toISOString(),
                buyerName: profile?.fullName ?? null,
                productTitle: product?.title ?? '',
                productImage: product ? (await storageUrl(ctx, product.galleryImages[0])) ?? '' : '',
                productSlug: product?.slug ?? '',
                isAuto: review.isAuto,
            };
        }));
    },
});

export const listClaims = query({
    args: {},
    handler: async (ctx) => {
        const { shop } = await sellerContext(ctx);
        const orders = (await ctx.db.query('orders').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect())
            .filter((order) => order.status === 'incident')
            .sort((left, right) => right.createdAt - left.createdAt);
        return await Promise.all(orders.map(async (order) => {
            const items = await ctx.db.query('orderItems').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
            let itemCount = 0;
            let firstProductTitle = '';
            let firstProductImage = '';
            let shippingAmount = 0;
            for (const item of items) {
                const variant = item.variantId ? await ctx.db.get(item.variantId) : item.variantLegacyId
                    ? await ctx.db.query('productVariants').withIndex('by_legacy_id', (q) => q.eq('legacyId', item.variantLegacyId!)).unique() : null;
                const product = variant?.productId ? await ctx.db.get(variant.productId) : variant?.productLegacyId
                    ? await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', variant.productLegacyId)).unique() : null;
                if (!variant || !product || item.quantity <= 0) continue;
                itemCount += item.quantity;
                shippingAmount = Math.max(shippingAmount, (item.shippingCostAtPurchaseCents ?? variant.shippingCostCents ?? 0) / 100);
                if (!firstProductTitle) {
                    firstProductTitle = product.title;
                    firstProductImage = (await storageUrl(ctx, variant.variantImage)) ?? (await storageUrl(ctx, product.galleryImages[0])) ?? '';
                }
            }
            const incident = (await ctx.db.query('orderIncidents').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect())[0] ?? null;
            const totalAmount = order.totalAmountCents / 100;
            const refundAmount = Math.max(0, totalAmount - shippingAmount);
            return {
                orderId: order.legacyId,
                publicId: order.publicId,
                createdAt: new Date(order.createdAt).toISOString(),
                buyerEmail: order.buyerEmail ?? null,
                buyerName: order.shippingFullName ?? null,
                incidentDescription: incident?.description ?? '',
                incidentPhotos: await Promise.all((incident?.photos ?? []).map((photo) => storageUrl(ctx, photo))),
                incidentCreatedAt: new Date(incident?.createdAt ?? order.createdAt).toISOString(),
                firstProductTitle,
                firstProductImage,
                itemCount,
                totalAmount,
                shippingAmount,
                refundAmount,
            };
        }));
    },
});

export const replyReview = mutation({
    args: { reviewId: v.string(), reply: v.string() },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const review = await ctx.db.query('reviews').withIndex('by_legacy_id', (q) => q.eq('legacyId', args.reviewId)).unique();
        const product = review?.productId ? await ctx.db.get(review.productId) : null;
        if (!review || !product || (product.shopId !== shop._id && product.shopLegacyId !== shop.legacyId)) throw new Error('Review access denied');
        const trimmed = args.reply.trim();
        await ctx.db.patch(review._id, { sellerReply: trimmed || undefined, sellerReplyAt: trimmed ? Date.now() : undefined });
        return { ok: true };
    },
});

export const syncPaymentAccount = mutation({
    args: {
        stripeAccountId: v.string(),
        chargesEnabled: v.boolean(),
        payoutsEnabled: v.boolean(),
        detailsSubmitted: v.boolean(),
    },
    handler: async (ctx, args) => {
        const { shop } = await sellerContext(ctx);
        const existing = await ctx.db.query('shopPaymentAccounts').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).unique();
        const now = Date.now();
        const values = {
            stripeAccountId: args.stripeAccountId,
            chargesEnabled: args.chargesEnabled,
            payoutsEnabled: args.payoutsEnabled,
            detailsSubmitted: args.detailsSubmitted,
            updatedAt: now,
            ...(args.chargesEnabled && args.payoutsEnabled && args.detailsSubmitted ? { onboardingCompletedAt: existing?.onboardingCompletedAt ?? now } : {}),
        };
        if (existing) await ctx.db.patch(existing._id, values);
        else await ctx.db.insert('shopPaymentAccounts', { legacyId: `convex:payment:${crypto.randomUUID()}`, shopId: shop._id, shopLegacyId: shop.legacyId, createdAt: now, ...values });
        await ctx.db.patch(shop._id, { paymentsActive: args.chargesEnabled && args.payoutsEnabled && args.detailsSubmitted });
        return { ready: args.chargesEnabled && args.payoutsEnabled && args.detailsSubmitted };
    },
});
