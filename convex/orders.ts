import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';
import { storageUrl } from './catalog';

type OrderDoc = Doc<'orders'>;
type ProductDoc = Doc<'products'>;
type VariantDoc = Doc<'productVariants'>;
type ShopDoc = Doc<'shops'>;

type ResolvedOrderItem = {
    productId: string;
    productTitle: string;
    productSlug: string;
    shopId: string;
    shopSlug: string;
    shopName: string;
    sellerEmail: string | null;
    imageUrl: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    shippingCost: number;
};

async function productByLegacyId(ctx: QueryCtx, legacyId: string | undefined): Promise<ProductDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function variantByLegacyId(ctx: QueryCtx, legacyId: string | undefined): Promise<VariantDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('productVariants').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function shopByLegacyId(ctx: QueryCtx, legacyId: string | undefined): Promise<ShopDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('shops').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function resolveVariant(ctx: QueryCtx, item: Doc<'orderItems'>): Promise<VariantDoc | null> {
    return item.variantId ? await ctx.db.get(item.variantId) : await variantByLegacyId(ctx, item.variantLegacyId);
}

async function resolveProduct(ctx: QueryCtx, variant: VariantDoc): Promise<ProductDoc | null> {
    return variant.productId ? await ctx.db.get(variant.productId) : await productByLegacyId(ctx, variant.productLegacyId);
}

async function resolveShop(ctx: QueryCtx, product: ProductDoc): Promise<ShopDoc | null> {
    return product.shopId ? await ctx.db.get(product.shopId) : await shopByLegacyId(ctx, product.shopLegacyId);
}

async function resolveOrderItems(ctx: QueryCtx, order: OrderDoc): Promise<ResolvedOrderItem[]> {
    const orderItems = await ctx.db
        .query('orderItems')
        .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
        .collect();

    const items = (await Promise.all(orderItems.map(async (item) => {
        const variant = await resolveVariant(ctx, item);
        if (!variant) return null;
        const product = await resolveProduct(ctx, variant);
        if (!product) return null;
        const shop = await resolveShop(ctx, product);
        if (!shop) return null;

        const [variantImage, galleryImages] = await Promise.all([
            storageUrl(ctx, variant.variantImage),
            Promise.all(product.galleryImages.map((image) => storageUrl(ctx, image))),
        ]);

        return {
            productId: product.legacyId,
            productTitle: product.title,
            productSlug: product.slug,
            shopId: shop.legacyId,
            shopSlug: shop.slug,
            shopName: shop.name,
            sellerEmail: shop.contactEmail ?? null,
            imageUrl: variantImage ?? galleryImages.find(Boolean) ?? '',
            variantName: variant.variantName ?? null,
            quantity: item.quantity,
            unitPrice: item.priceAtPurchaseCents / 100,
            shippingCost: (item.shippingCostAtPurchaseCents ?? variant.shippingCostCents ?? 0) / 100,
        };
    }))).filter((item): item is NonNullable<typeof item> => item !== null);

    return items;
}

async function serializeBuyerOrder(ctx: QueryCtx, order: OrderDoc, profileId: Doc<'profiles'>['_id']) {
    const items = await resolveOrderItems(ctx, order);

    const [shipments, incidents, refunds] = await Promise.all([
        ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect(),
        ctx.db.query('orderIncidents').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect(),
        ctx.db.query('refunds').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect(),
    ]);

    const productIds = [...new Set(items.map((item) => item.productId))];
    const reviews = await Promise.all(productIds.map(async (productId) => {
        const product = await productByLegacyId(ctx, productId);
        if (!product) return null;
        const review = await ctx.db
            .query('reviews')
            .withIndex('by_product_id', (q) => q.eq('productId', product._id))
            .filter((q) => q.eq(q.field('profileId'), profileId))
            .first();
        return review ? [productId, { rating: review.rating, comment: review.comment ?? null }] as const : null;
    }));

    const reviewMap = Object.fromEntries(reviews.filter((review): review is NonNullable<typeof review> => review !== null));
    const shipment = shipments[0] ?? null;
    const incident = incidents[0] ?? null;
    const refundedAmount = refunds.reduce((sum, refund) => sum + refund.amountCents / 100, 0);
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const totalAmount = order.totalAmountCents / 100;

    return {
        orderId: order.legacyId,
        publicId: order.publicId,
        status: order.status,
        totalAmount,
        subtotal,
        shipping: Math.max(0, totalAmount - subtotal),
        createdAt: new Date(order.createdAt).toISOString(),
        cancellationReason: order.cancellationReason ?? null,
        items: items.map(({ productId, productTitle, productSlug, shopId, shopName, shopSlug, imageUrl, variantName, quantity, unitPrice }) => ({
            productId,
            productTitle,
            productSlug,
            shopId,
            shopName,
            shopSlug,
            imageUrl,
            variantName,
            quantity,
            unitPrice,
        })),
        hasShipment: shipment !== null,
        trackingNumber: shipment?.trackingNumber ?? null,
        trackingUrl: shipment?.trackingUrl ?? null,
        labelUrl: shipment?.sendcloudShipmentId
            ? `/api/sendcloud/label?shipmentId=${encodeURIComponent(shipment.sendcloudShipmentId)}`
            : null,
        carrierName: shipment?.carrierName ?? null,
        incidentDescription: incident?.description ?? null,
        incidentPhotos: (await Promise.all(incident?.photos.map((photo) => storageUrl(ctx, photo)) ?? []))
            .filter((photo): photo is string => photo !== null),
        sellerEmail: items.find((item) => item.sellerEmail)?.sellerEmail ?? null,
        refundedAmount: refundedAmount > 0 ? refundedAmount : null,
        shippingRetained: refundedAmount > 0 ? Math.max(0, totalAmount - refundedAmount) : null,
        reviews: reviewMap,
    };
}

/** Returns the authenticated buyer's visible order history. */
export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) return [];

        const orders = await ctx.db
            .query('orders')
            .withIndex('by_buyer_id', (q) => q.eq('buyerId', profile._id))
            .collect();

        const visibleOrders = orders
            .filter((order) => order.buyerHiddenAt == null)
            .sort((a, b) => b.createdAt - a.createdAt);

        return await Promise.all(visibleOrders.map((order) => serializeBuyerOrder(ctx, order, profile._id)));
    },
});

/** Returns orders for a shop after verifying that the caller owns it. */
export const listForShop = query({
    args: { shopLegacyId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile?.isSeller) throw new Error('Seller access required');

        const shop = await shopByLegacyId(ctx, args.shopLegacyId);
        if (!shop || (shop.ownerId !== profile._id && shop.ownerLegacyId !== profile.legacyId)) {
            throw new Error('Shop access required');
        }

        const orders = await ctx.db
            .query('orders')
            .withIndex('by_shop_id', (q) => q.eq('shopId', shop._id))
            .collect();

        return await Promise.all(
            orders
                .sort((a, b) => b.createdAt - a.createdAt)
                .map(async (order) => {
                    const [items, shipments, refunds] = await Promise.all([
                        resolveOrderItems(ctx, order),
                        ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect(),
                        ctx.db.query('refunds').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect(),
                    ]);
                    const refundedAmount = refunds.reduce((sum, refund) => sum + refund.amountCents / 100, 0);
                    const shipment = shipments[0] ?? null;

                    return {
                        orderId: order.legacyId,
                        publicId: order.publicId,
                        status: order.status,
                        paymentStatus: order.paymentStatus,
                        totalAmount: order.totalAmountCents / 100,
                        createdAt: new Date(order.createdAt).toISOString(),
                        deliveredAt: order.deliveredAt == null ? null : new Date(order.deliveredAt).toISOString(),
                        cancellationReason: order.cancellationReason ?? null,
                        buyerEmail: order.buyerEmail ?? null,
                        shippingFullName: order.shippingFullName ?? null,
                        shippingPhone: order.shippingPhone ?? null,
                        shippingAddress: order.shippingAddress ?? null,
                        deliveryType: order.deliveryType ?? null,
                        pickupPointCarrier: order.pickupPointCarrier ?? null,
                        pickupPointName: order.pickupPointName ?? null,
                        items: items.map(({ productTitle, productSlug, imageUrl, variantName, quantity, unitPrice, shippingCost }) => ({
                            productTitle,
                            productSlug,
                            imageUrl,
                            variantName,
                            quantity,
                            unitPrice,
                            shippingCost,
                        })),
                        hasShipment: shipment !== null,
                        shipmentId: shipment?.legacyId ?? null,
                        trackingNumber: shipment?.trackingNumber ?? null,
                        trackingUrl: shipment?.trackingUrl ?? null,
                        labelUrl: shipment?.sendcloudShipmentId
                            ? `/api/sendcloud/label?shipmentId=${encodeURIComponent(shipment.sendcloudShipmentId)}`
                            : null,
                        carrierName: shipment?.carrierName ?? null,
                        serviceName: shipment?.serviceName ?? null,
                        labelCost: shipment?.priceCents == null ? null : shipment.priceCents / 100,
                        refundedAmount: refundedAmount > 0 ? refundedAmount : null,
                        shippingRetained: refundedAmount > 0
                            ? Math.max(0, order.totalAmountCents / 100 - refundedAmount)
                            : null,
                    };
                }),
        );
    },
});
