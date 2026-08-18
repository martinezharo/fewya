import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { identity, profileForIdentity } from './lib/auth';
import { storageUrl } from './catalog';

type ReadCtx = QueryCtx | MutationCtx;

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

async function productByLegacyId(ctx: ReadCtx, legacyId: string | undefined): Promise<ProductDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('products').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function variantByLegacyId(ctx: ReadCtx, legacyId: string | undefined): Promise<VariantDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('productVariants').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function shopByLegacyId(ctx: ReadCtx, legacyId: string | undefined): Promise<ShopDoc | null> {
    if (!legacyId) return null;
    return await ctx.db.query('shops').withIndex('by_legacy_id', (q) => q.eq('legacyId', legacyId)).unique();
}

async function resolveVariant(ctx: ReadCtx, item: Doc<'orderItems'>): Promise<VariantDoc | null> {
    return item.variantId ? await ctx.db.get(item.variantId) : await variantByLegacyId(ctx, item.variantLegacyId);
}

async function resolveProduct(ctx: ReadCtx, variant: VariantDoc): Promise<ProductDoc | null> {
    return variant.productId ? await ctx.db.get(variant.productId) : await productByLegacyId(ctx, variant.productLegacyId);
}

async function resolveShop(ctx: ReadCtx, product: ProductDoc): Promise<ShopDoc | null> {
    return product.shopId ? await ctx.db.get(product.shopId) : await shopByLegacyId(ctx, product.shopLegacyId);
}

async function resolveOrderItems(ctx: ReadCtx, order: OrderDoc): Promise<ResolvedOrderItem[]> {
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

type ShipmentContext = {
    orderId: string;
    publicId: string;
    status: OrderDoc['status'];
    buyerEmail: string | null;
    shippingFullName: string | null;
    shippingPhone: string | null;
    shippingAddress: string | null;
    deliveryType: 'home' | 'pickup_point' | null;
    pickupPointId: string | null;
    pickupPointName: string | null;
    pickupPointAddress: string | null;
    pickupPointPostalCode: string | null;
    pickupPointCity: string | null;
    pickupPointCarrier: string | null;
    shop: { name: string; contactEmail: string | null };
    owner: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        phonePrefix: string | null;
        email: string;
        addressStreet: string | null;
        addressNumber: string | null;
        addressFloor: string | null;
        addressPostalCode: string | null;
        addressCity: string | null;
        addressCountry: string | null;
    };
    items: Array<{
        quantity: number;
        weightKg: number | null;
        lengthCm: number | null;
        widthCm: number | null;
        heightCm: number | null;
        shippingCostCents: number;
    }>;
    shipment: {
        legacyId: string;
        sendcloudShipmentId: string | null;
        trackingNumber: string | null;
        trackingUrl: string | null;
        labelUrl: string | null;
        status: string;
    } | null;
};

async function shipmentContextForSeller(ctx: QueryCtx | MutationCtx, orderId: string, profile: Doc<'profiles'>): Promise<ShipmentContext> {
    const order = await ctx.db
        .query('orders')
        .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderId))
        .unique();
    if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');

    const shop = order.shopId
        ? await ctx.db.get(order.shopId)
        : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
    if (!shop || (shop.ownerId !== profile._id && shop.ownerLegacyId !== profile.legacyId)) {
        throw new Error('Seller access required');
    }

    const owner = shop.ownerId
        ? await ctx.db.get(shop.ownerId)
        : await ctx.db.query('profiles').withIndex('by_legacy_id', (q) => q.eq('legacyId', shop.ownerLegacyId)).unique();
    if (!owner) throw new Error('Seller profile not found');

    const orderItems = await ctx.db
        .query('orderItems')
        .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
        .collect();
    const items: ShipmentContext['items'] = [];
    for (const item of orderItems) {
        const variant = item.variantId
            ? await ctx.db.get(item.variantId)
            : await variantByLegacyId(ctx, item.variantLegacyId);
        if (!variant) continue;
        items.push({
            quantity: item.quantity,
            weightKg: variant.weightKg ?? null,
            lengthCm: variant.lengthCm ?? null,
            widthCm: variant.widthCm ?? null,
            heightCm: variant.heightCm ?? null,
            shippingCostCents: item.shippingCostAtPurchaseCents ?? variant.shippingCostCents ?? 0,
        });
    }

    const shipments = await ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
    const shipment = shipments[0];
    return {
        orderId: order.legacyId,
        publicId: order.publicId,
        status: order.status,
        buyerEmail: order.buyerEmail ?? null,
        shippingFullName: order.shippingFullName ?? null,
        shippingPhone: order.shippingPhone ?? null,
        shippingAddress: order.shippingAddress ?? null,
        deliveryType: order.deliveryType ?? null,
        pickupPointId: order.pickupPointId ?? null,
        pickupPointName: order.pickupPointName ?? null,
        pickupPointAddress: order.pickupPointAddress ?? null,
        pickupPointPostalCode: order.pickupPointPostalCode ?? null,
        pickupPointCity: order.pickupPointCity ?? null,
        pickupPointCarrier: order.pickupPointCarrier ?? null,
        shop: { name: shop.name, contactEmail: shop.contactEmail ?? null },
        owner: {
            firstName: owner.firstName ?? null,
            lastName: owner.lastName ?? null,
            phone: owner.phone ?? null,
            phonePrefix: owner.phonePrefix ?? null,
            email: owner.email,
            addressStreet: owner.addressStreet ?? null,
            addressNumber: owner.addressNumber ?? null,
            addressFloor: owner.addressFloor ?? null,
            addressPostalCode: owner.addressPostalCode ?? null,
            addressCity: owner.addressCity ?? null,
            addressCountry: owner.addressCountry ?? null,
        },
        items,
        shipment: shipment ? {
            legacyId: shipment.legacyId,
            sendcloudShipmentId: shipment.sendcloudShipmentId ?? null,
            trackingNumber: shipment.trackingNumber ?? null,
            trackingUrl: shipment.trackingUrl ?? null,
            labelUrl: shipment.labelUrl ?? null,
            status: shipment.status,
        } : null,
    };
}

/** Returns the order and seller data needed to request a shipment label. */
export const getShipmentContext = query({
    args: { orderId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile?.isSeller) throw new Error('Seller access required');
        return await shipmentContextForSeller(ctx, args.orderId, profile);
    },
});

const shipmentMutationArgs = {
    orderId: v.string(),
    sendcloudShipmentId: v.string(),
    sendcloudReference: v.optional(v.string()),
    carrierId: v.optional(v.string()),
    carrierName: v.optional(v.string()),
    serviceName: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
    trackingNumber: v.optional(v.string()),
    trackingUrl: v.optional(v.string()),
    labelUrl: v.optional(v.string()),
};

/** Persists a shipment and moves a paid order into seller processing. */
export const createShipmentForSeller = mutation({
    args: shipmentMutationArgs,
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile?.isSeller) throw new Error('Seller access required');

        const context = await shipmentContextForSeller(ctx, args.orderId, profile);
        if (!['paid', 'processing'].includes(context.status)) {
            throw new Error('Order is not ready for shipment');
        }

        const existingByProvider = await ctx.db
            .query('shipments')
            .withIndex('by_sendcloud_shipment_id', (q) => q.eq('sendcloudShipmentId', args.sendcloudShipmentId))
            .unique();
        if (existingByProvider) {
            if (existingByProvider.orderLegacyId !== context.orderId) throw new Error('Shipment provider id is already attached to another order');
            return {
                shipmentId: existingByProvider.sendcloudShipmentId ?? existingByProvider.legacyId,
                trackingNumber: existingByProvider.trackingNumber ?? null,
                trackingUrl: existingByProvider.trackingUrl ?? null,
                labelUrl: existingByProvider.labelUrl ?? null,
                carrierName: existingByProvider.carrierName ?? null,
                serviceName: existingByProvider.serviceName ?? null,
                status: existingByProvider.status,
                orderId: context.orderId,
                publicId: context.publicId,
            };
        }

        const now = Date.now();
        const order = await ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.orderId))
            .unique();
        if (!order) throw new Error('Order not found');

        const shipmentId = await ctx.db.insert('shipments', {
            legacyId: `convex:shipment:${args.sendcloudShipmentId}`,
            orderId: order._id,
            orderLegacyId: order.legacyId,
            sendcloudShipmentId: args.sendcloudShipmentId,
            ...(args.sendcloudReference === undefined ? {} : { sendcloudReference: args.sendcloudReference }),
            ...(args.carrierId === undefined ? {} : { carrierId: args.carrierId }),
            ...(args.carrierName === undefined ? {} : { carrierName: args.carrierName }),
            ...(args.serviceName === undefined ? {} : { serviceName: args.serviceName }),
            status: 'label_ready',
            ...(args.trackingNumber === undefined ? {} : { trackingNumber: args.trackingNumber }),
            ...(args.trackingUrl === undefined ? {} : { trackingUrl: args.trackingUrl }),
            priceCents: args.priceCents,
            currency: args.currency,
            ...(args.labelUrl === undefined ? {} : { labelUrl: args.labelUrl }),
            requestedAt: now,
            createdAt: now,
            updatedAt: now,
        });
        if (order.status === 'paid') {
            await ctx.db.patch(order._id, { status: 'processing' });
        }

        return {
            shipmentId: args.sendcloudShipmentId,
            trackingNumber: args.trackingNumber ?? null,
            trackingUrl: args.trackingUrl ?? null,
            labelUrl: args.labelUrl ?? null,
            carrierName: args.carrierName ?? null,
            serviceName: args.serviceName ?? null,
            status: 'label_ready' as const,
            orderId: context.orderId,
            publicId: context.publicId,
            internalId: String(shipmentId),
        };
    },
});

/** Returns a shipment to either its buyer or the owning seller. */
export const getShipmentForAccess = query({
    args: { shipmentId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Authentication required');

        const shipment = await ctx.db
            .query('shipments')
            .withIndex('by_sendcloud_shipment_id', (q) => q.eq('sendcloudShipmentId', args.shipmentId))
            .unique();
        if (!shipment) return null;

        const order = shipment.orderId
            ? await ctx.db.get(shipment.orderId)
            : await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId)).unique();
        if (!order || !isNewConvexOrder(order)) return null;

        const shop = order.shopId
            ? await ctx.db.get(order.shopId)
            : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
        const isBuyer = order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId;
        const isSeller = Boolean(shop && (shop.ownerId === profile._id || shop.ownerLegacyId === profile.legacyId));
        if (!isBuyer && !isSeller) throw new Error('Shipment access required');

        return {
            shipmentId: shipment.sendcloudShipmentId ?? shipment.legacyId,
            internalId: shipment.legacyId,
            labelUrl: shipment.labelUrl ?? null,
            publicId: order.publicId,
        };
    },
});

/** Updates a label marker after a provider URL has been copied to storage. */
export const updateShipmentLabelUrl = mutation({
    args: { shipmentId: v.string(), labelUrl: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Authentication required');

        const shipment = await ctx.db
            .query('shipments')
            .withIndex('by_sendcloud_shipment_id', (q) => q.eq('sendcloudShipmentId', args.shipmentId))
            .unique();
        if (!shipment) throw new Error('Shipment not found');
        const order = shipment.orderId
            ? await ctx.db.get(shipment.orderId)
            : await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId)).unique();
        if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
        const shop = order.shopId
            ? await ctx.db.get(order.shopId)
            : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
        const isBuyer = order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId;
        const isSeller = Boolean(shop && (shop.ownerId === profile._id || shop.ownerLegacyId === profile.legacyId));
        if (!isBuyer && !isSeller) throw new Error('Shipment access required');

        await ctx.db.patch(shipment._id, { labelUrl: args.labelUrl, updatedAt: Date.now() });
        return { updated: true, shipmentId: shipment.sendcloudShipmentId ?? shipment.legacyId };
    },
});

async function orderByLegacyId(ctx: ReadCtx, orderId: string): Promise<OrderDoc | null> {
    return await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', orderId)).unique();
}

async function sellerOrderForIdentity(ctx: MutationCtx, orderId: string) {
    const user = await identity(ctx);
    const profile = await profileForIdentity(ctx, user);
    if (!profile?.isSeller) throw new Error('Seller access required');
    const order = await orderByLegacyId(ctx, orderId);
    if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
    const shop = order.shopId
        ? await ctx.db.get(order.shopId)
        : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
    if (!shop || (shop.ownerId !== profile._id && shop.ownerLegacyId !== profile.legacyId)) {
        throw new Error('Seller access required');
    }
    return { order, profile };
}

async function buyerOrderForIdentity(ctx: MutationCtx, orderId: string) {
    const user = await identity(ctx);
    const profile = await profileForIdentity(ctx, user);
    if (!profile) throw new Error('Authentication required');
    const order = await orderByLegacyId(ctx, orderId);
    if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
    if (order.buyerId !== profile._id && order.buyerLegacyId !== profile.legacyId) {
        throw new Error('Buyer access required');
    }
    return { order, profile };
}

async function restoreOrderStock(ctx: MutationCtx, order: OrderDoc) {
    const items = await ctx.db.query('orderItems').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
    for (const item of items) {
        const variant = item.variantId
            ? await ctx.db.get(item.variantId)
            : await variantByLegacyId(ctx, item.variantLegacyId);
        if (variant) await ctx.db.patch(variant._id, { stock: variant.stock + item.quantity });
    }
}

async function recordConvexRefund(
    ctx: MutationCtx,
    order: OrderDoc,
    profile: Doc<'profiles'>,
    amountCents: number,
    currency: string,
    reason: string,
    stripeRefundId?: string,
) {
    const existing = await ctx.db.query('refunds').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
    if (existing.some((refund) => refund.amountCents === amountCents && refund.reason === reason)) return;
    await ctx.db.insert('refunds', {
        legacyId: `convex:refund:${order.legacyId}:${reason}:${Date.now()}`,
        orderId: order._id,
        orderLegacyId: order.legacyId,
        amountCents,
        currency,
        reason,
        ...(stripeRefundId === undefined ? {} : { stripeRefundId }),
        processedBy: profile._id,
        processedByLegacyId: profile.legacyId,
        createdAt: Date.now(),
    });
}

/** Hides a pending checkout from the authenticated buyer's history. */
export const hideForCurrentBuyer = mutation({
    args: { orderId: v.string() },
    handler: async (ctx, args) => {
        const { order } = await buyerOrderForIdentity(ctx, args.orderId);
        if (order.status !== 'pending') throw new Error('Order cannot be hidden');
        await ctx.db.patch(order._id, { buyerHiddenAt: Date.now() });
        return { success: true, orderId: order.legacyId, publicId: order.publicId };
    },
});

/** Cancels a paid/processing order, restores stock, and records its refund. */
export const cancelForSeller = mutation({
    args: {
        orderId: v.string(),
        cancellationReason: v.optional(v.string()),
        refundAmountCents: v.number(),
        currency: v.string(),
        stripeRefundId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { order, profile } = await sellerOrderForIdentity(ctx, args.orderId);
        if (order.status === 'cancelled') return { success: true, orderId: order.legacyId, publicId: order.publicId };
        if (!['paid', 'processing'].includes(order.status)) throw new Error('Order cannot be cancelled');
        await restoreOrderStock(ctx, order);
        await ctx.db.patch(order._id, {
            status: 'cancelled',
            ...(args.cancellationReason?.trim() ? { cancellationReason: args.cancellationReason.trim() } : {}),
        });
        if (args.refundAmountCents > 0) {
            await recordConvexRefund(ctx, order, profile, args.refundAmountCents, args.currency, 'seller_cancellation', args.stripeRefundId);
        }
        return { success: true, orderId: order.legacyId, publicId: order.publicId };
    },
});

/** Confirms delivered/incident order delivery for its buyer. */
export const confirmDeliveryForBuyer = mutation({
    args: { orderId: v.string() },
    handler: async (ctx, args) => {
        const { order } = await buyerOrderForIdentity(ctx, args.orderId);
        if (!['delivered', 'incident'].includes(order.status)) throw new Error('Order cannot be confirmed');
        await ctx.db.patch(order._id, { status: 'confirmed', fundsReleasedAt: Date.now() });
        return { success: true, orderId: order.legacyId, publicId: order.publicId, stripePaymentIntentId: order.stripePaymentIntentId ?? null };
    },
});

/** Seller-side confirmation after the 48-hour delivery hold. */
export const confirmDeliveryForSeller = mutation({
    args: { orderId: v.string(), cutoff: v.number() },
    handler: async (ctx, args) => {
        const { order } = await sellerOrderForIdentity(ctx, args.orderId);
        if (order.status === 'confirmed') return { success: true, orderId: order.legacyId, publicId: order.publicId, stripePaymentIntentId: order.stripePaymentIntentId ?? null };
        if (order.status !== 'delivered' || order.deliveredAt == null || order.deliveredAt >= args.cutoff || order.fundsReleasedAt != null) {
            throw new Error('Order cannot be confirmed yet');
        }
        await ctx.db.patch(order._id, { status: 'confirmed', fundsReleasedAt: Date.now() });
        return { success: true, orderId: order.legacyId, publicId: order.publicId, stripePaymentIntentId: order.stripePaymentIntentId ?? null };
    },
});

/** Opens a buyer incident and stores its already-uploaded photo paths. */
export const reportIncidentForBuyer = mutation({
    args: { orderId: v.string(), description: v.string(), photos: v.array(v.string()) },
    handler: async (ctx, args) => {
        const { order } = await buyerOrderForIdentity(ctx, args.orderId);
        if (args.description.replace(/\s/g, '').length < 50) throw new Error('Description too short');
        if (args.photos.length < 3 || args.photos.length > 20) throw new Error('Invalid incident photos');
        if (!['delivered', 'confirmed'].includes(order.status)) throw new Error('Order cannot be reported');
        const now = Date.now();
        await ctx.db.insert('orderIncidents', {
            legacyId: `convex:incident:${order.legacyId}:${now}`,
            orderId: order._id,
            orderLegacyId: order.legacyId,
            description: args.description,
            photos: args.photos,
            createdAt: now,
        });
        await ctx.db.patch(order._id, { status: 'incident' });
        return { success: true, orderId: order.legacyId, publicId: order.publicId };
    },
});

/** Checks buyer ownership and status before accepting an incident photo. */
export const getIncidentUploadContext = query({
    args: { orderId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Authentication required');
        const order = await orderByLegacyId(ctx, args.orderId);
        if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
        if (order.buyerId !== profile._id && order.buyerLegacyId !== profile.legacyId) throw new Error('Buyer access required');
        return { orderId: order.legacyId, status: order.status };
    },
});

async function resolveOrderRefund(ctx: MutationCtx, args: { orderId: string; amountCents: number; currency: string; reason: string; stripeRefundId?: string }, expectedStatus: 'incident' | 'delivery_failed') {
    const { order, profile } = await sellerOrderForIdentity(ctx, args.orderId);
    if (order.status !== expectedStatus && order.status !== 'refunded') throw new Error('Order is not refundable in its current status');
    if (order.status !== 'refunded') await ctx.db.patch(order._id, { status: 'refunded' });
    if (args.amountCents > 0) await recordConvexRefund(ctx, order, profile, args.amountCents, args.currency, args.reason, args.stripeRefundId);
    return { success: true, orderId: order.legacyId, publicId: order.publicId };
}

export const resolveIncidentWithRefund = mutation({
    args: { orderId: v.string(), amountCents: v.number(), currency: v.string(), reason: v.string(), stripeRefundId: v.optional(v.string()) },
    handler: async (ctx, args) => await resolveOrderRefund(ctx, args, 'incident'),
});

export const resolveDeliveryFailureWithRefund = mutation({
    args: { orderId: v.string(), amountCents: v.number(), currency: v.string(), reason: v.string(), stripeRefundId: v.optional(v.string()) },
    handler: async (ctx, args) => await resolveOrderRefund(ctx, args, 'delivery_failed'),
});

/** Authenticated payout data for buyer/seller order actions. */
export const getPayoutContextForCurrentUser = query({
    args: { orderId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Authentication required');
        const order = await orderByLegacyId(ctx, args.orderId);
        if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
        const shop = order.shopId
            ? await ctx.db.get(order.shopId)
            : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
        const isBuyer = order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId;
        const isSeller = Boolean(shop && (shop.ownerId === profile._id || shop.ownerLegacyId === profile.legacyId));
        if (!isBuyer && !isSeller) throw new Error('Order access required');

        const shipments = await ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
        const labelCostByShop: Record<string, number> = {};
        if (order.shopLegacyId && shipments[0]?.priceCents != null) {
            labelCostByShop[order.shopLegacyId] = shipments[0].priceCents / 100;
        }
        return {
            id: order.legacyId,
            publicId: order.publicId,
            status: order.status,
            totalAmount: order.totalAmountCents / 100,
            deliveredAt: order.deliveredAt ?? null,
            fundsReleaseStatus: order.fundsReleaseStatus,
            stripePaymentIntentId: order.stripePaymentIntentId ?? null,
            items: await payoutItemsForOrder(ctx, order),
            labelCostByShop,
        };
    },
});

const checkoutItemArgs = v.object({
    variantLegacyId: v.string(),
    quantity: v.number(),
    priceAtPurchaseCents: v.number(),
    shippingCostAtPurchaseCents: v.number(),
});

const checkoutOrderArgs = v.object({
    publicId: v.string(),
    shopLegacyId: v.string(),
    totalAmountCents: v.number(),
    buyerEmail: v.optional(v.string()),
    shippingFullName: v.optional(v.string()),
    shippingPhone: v.optional(v.string()),
    shippingAddress: v.optional(v.string()),
    deliveryType: v.union(v.literal('home'), v.literal('pickup_point')),
    pickupPointId: v.optional(v.string()),
    pickupPointName: v.optional(v.string()),
    pickupPointAddress: v.optional(v.string()),
    pickupPointPostalCode: v.optional(v.string()),
    pickupPointCity: v.optional(v.string()),
    pickupPointCarrier: v.optional(v.string()),
    items: v.array(checkoutItemArgs),
});

type CheckoutOrderInput = {
    publicId: string;
    shopLegacyId: string;
    totalAmountCents: number;
    buyerEmail?: string;
    shippingFullName?: string;
    shippingPhone?: string;
    shippingAddress?: string;
    deliveryType: 'home' | 'pickup_point';
    pickupPointId?: string;
    pickupPointName?: string;
    pickupPointAddress?: string;
    pickupPointPostalCode?: string;
    pickupPointCity?: string;
    pickupPointCarrier?: string;
    items: Array<{
        variantLegacyId: string;
        quantity: number;
        priceAtPurchaseCents: number;
        shippingCostAtPurchaseCents: number;
    }>;
};

function isNewConvexOrder(order: OrderDoc): boolean {
    // Imported orders retain their Supabase UUID as legacyId. Keeping payment
    // writes scoped to orders created after the cutover prevents a historical
    // pending order from reserving stock a second time in Convex.
    return order.legacyId.startsWith('convex:');
}

async function paymentAccountForShop(ctx: ReadCtx, shop: ShopDoc) {
    const related = await ctx.db
        .query('shopPaymentAccounts')
        .withIndex('by_shop_id', (q) => q.eq('shopId', shop._id))
        .first();
    if (related) return related;

    return await ctx.db
        .query('shopPaymentAccounts')
        .filter((q) => q.eq(q.field('shopLegacyId'), shop.legacyId))
        .first();
}

async function variantProductAndShop(ctx: ReadCtx, variantLegacyId: string) {
    const variant = await variantByLegacyId(ctx, variantLegacyId);
    if (!variant) return null;

    const product = variant.productId
        ? await ctx.db.get(variant.productId)
        : await productByLegacyId(ctx, variant.productLegacyId);
    if (!product) return null;

    const shop = product.shopId
        ? await ctx.db.get(product.shopId)
        : await shopByLegacyId(ctx, product.shopLegacyId);
    if (!shop) return null;

    return { variant, product, shop };
}

function checkoutOrderResponse(order: OrderDoc) {
    return {
        id: order.legacyId,
        public_id: order.publicId,
        status: order.status,
        payment_status: order.paymentStatus,
        stripe_checkout_session_id: order.stripeCheckoutSessionId ?? null,
        shop_id: order.shopLegacyId ?? null,
    };
}

async function ordersForSession(ctx: ReadCtx, sessionId: string): Promise<OrderDoc[]> {
    return await ctx.db
        .query('orders')
        .withIndex('by_stripe_session_id', (q) => q.eq('stripeCheckoutSessionId', sessionId))
        .collect();
}

/**
 * Returns only post-cutover orders for checkout confirmation. Historical
 * Supabase orders remain readable through the compatibility path until their
 * lifecycle endpoints have also moved to Convex.
 */
export const listForCheckoutSession = query({
    args: { sessionId: v.string() },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) return [];

        const orders = await ordersForSession(ctx, args.sessionId);
        return orders
            .filter((order) => isNewConvexOrder(order))
            .filter((order) => order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(checkoutOrderResponse);
    },
});

/**
 * Creates all shop orders for one Stripe Checkout Session atomically. Prices,
 * seller payment readiness and stock are re-validated against Convex instead
 * of trusting the browser's Supabase read or the posted totals.
 */
export const createCheckoutOrders = mutation({
    args: {
        checkoutGroupId: v.string(),
        stripeCheckoutSessionId: v.string(),
        currency: v.string(),
        orders: v.array(checkoutOrderArgs),
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');
        if (args.orders.length === 0) throw new Error('Checkout orders are required');

        const existingSessionOrders = await ordersForSession(ctx, args.stripeCheckoutSessionId);
        const created = [] as Array<ReturnType<typeof checkoutOrderResponse>>;
        const now = Date.now();

        for (const input of args.orders as CheckoutOrderInput[]) {
            const shop = await shopByLegacyId(ctx, input.shopLegacyId);
            if (!shop || !shop.isActive || shop.status !== 'active' || !shop.sellerDetailsComplete) {
                throw new Error('Seller is not ready for checkout');
            }

            const paymentAccount = await paymentAccountForShop(ctx, shop);
            if (!paymentAccount?.stripeAccountId || !paymentAccount.chargesEnabled || !paymentAccount.payoutsEnabled || !paymentAccount.detailsSubmitted) {
                throw new Error('Seller payment account is not ready');
            }

            const existing = existingSessionOrders.find((order) =>
                isNewConvexOrder(order)
                && (order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId)
                && (order.shopId === shop._id || order.shopLegacyId === shop.legacyId),
            );
            if (existing) {
                created.push(checkoutOrderResponse(existing));
                continue;
            }

            if (input.items.length === 0) throw new Error('Checkout items are required');

            let subtotalCents = 0;
            let shippingCents = 0;
            const resolvedItems: Array<{
                variant: VariantDoc;
                quantity: number;
                priceAtPurchaseCents: number;
                shippingCostAtPurchaseCents: number;
            }> = [];

            for (const item of input.items) {
                if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
                    throw new Error('Invalid checkout quantity');
                }

                const resolved = await variantProductAndShop(ctx, item.variantLegacyId);
                if (!resolved || !resolved.product.isActive || !resolved.shop.isActive || resolved.shop._id !== shop._id) {
                    throw new Error('Checkout product is unavailable');
                }
                if (resolved.variant.stock < item.quantity) throw new Error('insufficient_stock');

                const shippingCostAtPurchaseCents = resolved.variant.shippingCostCents ?? 0;
                if (item.priceAtPurchaseCents !== resolved.variant.priceCents
                    || item.shippingCostAtPurchaseCents !== shippingCostAtPurchaseCents) {
                    throw new Error('Checkout price changed');
                }

                subtotalCents += item.priceAtPurchaseCents * item.quantity;
                shippingCents = Math.max(shippingCents, item.shippingCostAtPurchaseCents);
                resolvedItems.push({
                    variant: resolved.variant,
                    quantity: item.quantity,
                    priceAtPurchaseCents: item.priceAtPurchaseCents,
                    shippingCostAtPurchaseCents,
                });
            }

            if (subtotalCents + shippingCents !== input.totalAmountCents) {
                throw new Error('Checkout total mismatch');
            }

            const legacyId = `convex:${input.publicId}`;
            const orderId = await ctx.db.insert('orders', {
                legacyId,
                publicId: input.publicId,
                checkoutGroupId: args.checkoutGroupId,
                buyerId: profile._id,
                buyerLegacyId: profile.legacyId,
                shopId: shop._id,
                shopLegacyId: shop.legacyId,
                status: 'pending',
                paymentStatus: 'pending',
                totalAmountCents: input.totalAmountCents,
                currency: args.currency || 'eur',
                hasInsurance: false,
                stripeCheckoutSessionId: args.stripeCheckoutSessionId,
                fundsReleaseStatus: 'pending',
                ...(input.buyerEmail === undefined ? {} : { buyerEmail: input.buyerEmail }),
                ...(input.shippingFullName === undefined ? {} : { shippingFullName: input.shippingFullName }),
                ...(input.shippingPhone === undefined ? {} : { shippingPhone: input.shippingPhone }),
                ...(input.shippingAddress === undefined ? {} : { shippingAddress: input.shippingAddress }),
                deliveryType: input.deliveryType,
                ...(input.pickupPointId === undefined ? {} : { pickupPointId: input.pickupPointId }),
                ...(input.pickupPointName === undefined ? {} : { pickupPointName: input.pickupPointName }),
                ...(input.pickupPointAddress === undefined ? {} : { pickupPointAddress: input.pickupPointAddress }),
                ...(input.pickupPointPostalCode === undefined ? {} : { pickupPointPostalCode: input.pickupPointPostalCode }),
                ...(input.pickupPointCity === undefined ? {} : { pickupPointCity: input.pickupPointCity }),
                ...(input.pickupPointCarrier === undefined ? {} : { pickupPointCarrier: input.pickupPointCarrier }),
                createdAt: now,
            });

            for (const [index, item] of resolvedItems.entries()) {
                await ctx.db.insert('orderItems', {
                    legacyId: `${legacyId}:${index}`,
                    orderId,
                    orderLegacyId: legacyId,
                    quantity: item.quantity,
                    priceAtPurchaseCents: item.priceAtPurchaseCents,
                    shippingCostAtPurchaseCents: item.shippingCostAtPurchaseCents,
                    variantId: item.variant._id,
                    variantLegacyId: item.variant.legacyId,
                });
            }

            const inserted = await ctx.db.get(orderId);
            if (inserted) created.push(checkoutOrderResponse(inserted));
        }

        return { orders: created };
    },
});

type PaymentOrderSummary = ReturnType<typeof checkoutOrderResponse>;

async function markOrdersPaid(
    ctx: MutationCtx,
    orders: OrderDoc[],
    paymentIntentId: string | undefined,
): Promise<PaymentOrderSummary[]> {
    const pendingOrders = orders.filter((order) => order.paymentStatus !== 'paid');
    const adjustments = new Map<string, { variant: VariantDoc; quantity: number }>();

    for (const order of pendingOrders) {
        if (order.status !== 'pending' && order.status !== 'paid') {
            throw new Error('Order cannot be paid in its current status');
        }

        const items = await ctx.db
            .query('orderItems')
            .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
            .collect();
        for (const item of items) {
            const variant = item.variantId
                ? await ctx.db.get(item.variantId)
                : item.variantLegacyId ? await variantByLegacyId(ctx, item.variantLegacyId) : null;
            if (!variant) throw new Error('Checkout variant is unavailable');

            const current = adjustments.get(String(variant._id));
            if (current) current.quantity += item.quantity;
            else adjustments.set(String(variant._id), { variant, quantity: item.quantity });
        }
    }

    for (const { variant, quantity } of adjustments.values()) {
        if (variant.stock < quantity) throw new Error('insufficient_stock');
    }

    for (const { variant, quantity } of adjustments.values()) {
        await ctx.db.patch(variant._id, { stock: variant.stock - quantity });
    }

    const paidAt = Date.now();
    for (const order of pendingOrders) {
        await ctx.db.patch(order._id, {
            status: 'paid',
            paymentStatus: 'paid',
            ...(paymentIntentId === undefined ? {} : { stripePaymentIntentId: paymentIntentId }),
            paidAt: order.paidAt ?? paidAt,
        });
    }

    return orders.map((order) => ({
        ...checkoutOrderResponse(order),
        status: 'paid' as const,
        payment_status: 'paid' as const,
        ...(paymentIntentId === undefined ? {} : { stripe_payment_intent_id: paymentIntentId }),
    }));
}

/** Marks the current buyer's Convex checkout orders paid after returning from Stripe. */
export const markPaidForCurrentUser = mutation({
    args: {
        sessionId: v.string(),
        paymentIntentId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await identity(ctx);
        const profile = await profileForIdentity(ctx, user);
        if (!profile) throw new Error('Profile is not linked to this account');

        const orders = (await ordersForSession(ctx, args.sessionId))
            .filter((order) => isNewConvexOrder(order))
            .filter((order) => order.buyerId === profile._id || order.buyerLegacyId === profile.legacyId);
        if (orders.length === 0) throw new Error('Checkout orders not found');

        return { success: true, orders: await markOrdersPaid(ctx, orders, args.paymentIntentId) };
    },
});

function assertWebhookSecret(secret: string): void {
    const expected = process.env.CONVEX_WEBHOOK_SECRET;
    if (!expected || secret !== expected) throw new Error('Webhook endpoint is not authorized');
}

/**
 * Idempotently applies a Stripe payment to post-cutover orders. The Worker
 * verifies Stripe's signature; this separate secret authenticates the Worker
 * to Convex so the webhook never needs a Clerk session.
 */
export const processStripePayment = mutation({
    args: {
        secret: v.string(),
        eventId: v.string(),
        sessionId: v.optional(v.string()),
        paymentIntentId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);

        const existingEvent = await ctx.db
            .query('processedWebhookEvents')
            .withIndex('by_event_id', (q) => q.eq('eventId', args.eventId))
            .unique();
        if (existingEvent) return { handled: true, alreadyProcessed: true, requiresRefund: false, orders: [] as PaymentOrderSummary[] };

        const matching = args.sessionId
            ? await ordersForSession(ctx, args.sessionId)
            : args.paymentIntentId
                ? await ctx.db
                    .query('orders')
                    .withIndex('by_stripe_payment_intent_id', (q) => q.eq('stripePaymentIntentId', args.paymentIntentId))
                    .collect()
                : [];
        const orders = matching.filter(isNewConvexOrder);
        if (orders.length === 0) return { handled: false, alreadyProcessed: false, requiresRefund: false, orders: [] as PaymentOrderSummary[] };

        let summaries: PaymentOrderSummary[];
        try {
            summaries = await markOrdersPaid(ctx, orders, args.paymentIntentId);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'payment_confirmation_failed';
            // No stock has been changed when markOrdersPaid fails: it validates
            // all variants before issuing any patches. Cancel the pending rows
            // in the same transaction before asking Stripe for a refund.
            for (const order of orders) {
                if (order.paymentStatus !== 'paid' && order.status === 'pending') {
                    await ctx.db.patch(order._id, { status: 'cancelled', cancellationReason: reason });
                }
            }
            await ctx.db.insert('processedWebhookEvents', {
                legacyId: `stripe:${args.eventId}`,
                eventId: args.eventId,
                source: 'stripe',
                createdAt: Date.now(),
            });
            return {
                handled: true,
                alreadyProcessed: false,
                requiresRefund: true,
                failureReason: reason,
                orders: orders.map(checkoutOrderResponse),
            };
        }

        await ctx.db.insert('processedWebhookEvents', {
            legacyId: `stripe:${args.eventId}`,
            eventId: args.eventId,
            source: 'stripe',
            createdAt: Date.now(),
        });
        return { handled: true, alreadyProcessed: false, requiresRefund: false, orders: summaries };
    },
});

function carrierShipmentStatus(status: string, current: 'pending' | 'label_ready' | 'shipped' | 'delivered' | 'failed' | 'cancelled'): 'pending' | 'label_ready' | 'shipped' | 'delivered' | 'failed' | 'cancelled' {
    const lower = status.trim().toLowerCase();
    const delivered = lower === 'delivered'
        || lower === 'parcel delivered'
        || lower.includes('delivered to recipient')
        || lower.includes('parcel delivered');
    if (delivered) return 'delivered';

    const failed = ['failed', 'returned_to_sender', 'delivery_failed', 'shipment_lost', 'cancelled_upstream'].includes(lower)
        || lower.includes('returned to sender')
        || lower.includes('parcel en route to sender')
        || lower.includes('unable to deliver')
        || lower.includes('delivery attempt failed')
        || lower.includes('lost');
    if (failed) return lower.includes('cancel') ? 'cancelled' : 'failed';

    const inTransit = ['shipped', 'in_transit', 'shipment.tracking.update'].includes(lower)
        || lower.includes('en route')
        || lower.includes('sorted')
        || lower.includes('at sorting center')
        || lower.includes('at hub')
        || lower.includes('out for delivery')
        || lower.includes('delivery attempted')
        || lower.includes('picked up')
        || lower.includes('collected')
        || lower.includes('awaiting customer pickup');
    if (inTransit) return 'shipped';
    if (['label_ready', 'ready to send', 'announced', 'no label'].includes(lower)) return 'label_ready';
    return current;
}

/** Lists post-cutover shipments that still need a Sendcloud poll. */
export const listTrackingCandidates = query({
    args: { secret: v.string() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const terminal = new Set(['delivered', 'failed', 'cancelled']);
        const shipments = await ctx.db.query('shipments').collect();
        const candidates: Array<{ id: string; sendcloudShipmentId: string; status: string }> = [];
        for (const shipment of shipments) {
            if (!shipment.sendcloudShipmentId || terminal.has(shipment.status)) continue;
            const order = shipment.orderId
                ? await ctx.db.get(shipment.orderId)
                : await ctx.db
                    .query('orders')
                    .withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId))
                    .unique();
            if (!order || !isNewConvexOrder(order)) continue;
            candidates.push({
                id: shipment.legacyId,
                sendcloudShipmentId: shipment.sendcloudShipmentId,
                status: shipment.status,
            });
        }
        return candidates;
    },
});

export const applyShipmentTracking = mutation({
    args: {
        secret: v.string(),
        shipmentLegacyId: v.string(),
        status: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        eventTimestamp: v.number(),
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        rawData: v.any(),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const shipment = await ctx.db
            .query('shipments')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.shipmentLegacyId))
            .unique();
        if (!shipment) throw new Error('Shipment not found');

        const order = shipment.orderId
            ? await ctx.db.get(shipment.orderId)
            : await ctx.db
                .query('orders')
                .withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId))
                .unique();
        if (!order || !isNewConvexOrder(order)) throw new Error('Shipment is not a Convex order');

        const mappedStatus = carrierShipmentStatus(args.status, shipment.status);
        const now = Date.now();
        await ctx.db.insert('shipmentTracking', {
            legacyId: `convex:tracking:${shipment.legacyId}:${now}:${crypto.randomUUID()}`,
            shipmentId: shipment._id,
            shipmentLegacyId: shipment.legacyId,
            status: args.status,
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.location === undefined ? {} : { location: args.location }),
            eventTimestamp: args.eventTimestamp,
            rawData: args.rawData,
            createdAt: now,
        });

        await ctx.db.patch(shipment._id, {
            status: mappedStatus,
            ...(args.trackingNumber === undefined ? {} : { trackingNumber: args.trackingNumber }),
            ...(args.trackingUrl === undefined ? {} : { trackingUrl: args.trackingUrl }),
            updatedAt: now,
        });

        const lower = args.status.trim().toLowerCase();
        const isDelivered = mappedStatus === 'delivered';
        const isFailure = mappedStatus === 'failed' || mappedStatus === 'cancelled';
        const isInTransit = mappedStatus === 'shipped';
        if (isDelivered && !['confirmed', 'incident', 'cancelled', 'refunded'].includes(order.status)) {
            await ctx.db.patch(order._id, {
                status: 'delivered',
                deliveredAt: order.deliveredAt ?? now,
                shippedAt: order.shippedAt ?? now,
            });
        } else if (isInTransit && ['paid', 'processing'].includes(order.status)) {
            await ctx.db.patch(order._id, { status: 'shipped', shippedAt: order.shippedAt ?? now });
        } else if (isFailure && ['processing', 'shipped'].includes(order.status)) {
            await ctx.db.patch(order._id, { status: 'delivery_failed' });
        }

        return {
            shipmentId: shipment.legacyId,
            status: mappedStatus,
            orderId: order.legacyId,
            carrierStatus: lower,
        };
    },
});

/** Idempotent Sendcloud webhook ingestion for post-cutover shipments. */
export const processShipmentTrackingEvent = mutation({
    args: {
        secret: v.string(),
        eventId: v.string(),
        sendcloudShipmentId: v.string(),
        status: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        eventTimestamp: v.number(),
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        rawData: v.any(),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const existing = await ctx.db.query('processedWebhookEvents').withIndex('by_event_id', (q) => q.eq('eventId', args.eventId)).unique();
        if (existing) return { handled: true, alreadyProcessed: true };

        const shipment = await ctx.db
            .query('shipments')
            .withIndex('by_sendcloud_shipment_id', (q) => q.eq('sendcloudShipmentId', args.sendcloudShipmentId))
            .unique();
        if (!shipment) return { handled: false, alreadyProcessed: false };
        const order = shipment.orderId
            ? await ctx.db.get(shipment.orderId)
            : await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId)).unique();
        if (!order || !isNewConvexOrder(order)) return { handled: false, alreadyProcessed: false };

        const mappedStatus = carrierShipmentStatus(args.status, shipment.status);
        const now = Date.now();
        await ctx.db.insert('shipmentTracking', {
            legacyId: `convex:tracking:${shipment.legacyId}:${now}:${crypto.randomUUID()}`,
            shipmentId: shipment._id,
            shipmentLegacyId: shipment.legacyId,
            status: args.status,
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.location === undefined ? {} : { location: args.location }),
            eventTimestamp: args.eventTimestamp,
            rawData: args.rawData,
            createdAt: now,
        });
        await ctx.db.patch(shipment._id, {
            status: mappedStatus,
            ...(args.trackingNumber === undefined ? {} : { trackingNumber: args.trackingNumber }),
            ...(args.trackingUrl === undefined ? {} : { trackingUrl: args.trackingUrl }),
            updatedAt: now,
        });

        if (mappedStatus === 'delivered' && !['confirmed', 'incident', 'cancelled', 'refunded'].includes(order.status)) {
            await ctx.db.patch(order._id, { status: 'delivered', deliveredAt: order.deliveredAt ?? now, shippedAt: order.shippedAt ?? now });
        } else if (mappedStatus === 'shipped' && ['paid', 'processing'].includes(order.status)) {
            await ctx.db.patch(order._id, { status: 'shipped', shippedAt: order.shippedAt ?? now });
        } else if ((mappedStatus === 'failed' || mappedStatus === 'cancelled') && ['processing', 'shipped'].includes(order.status)) {
            await ctx.db.patch(order._id, { status: 'delivery_failed' });
        }

        await ctx.db.insert('processedWebhookEvents', {
            legacyId: `sendcloud:${args.eventId}`,
            eventId: args.eventId,
            source: 'sendcloud',
            createdAt: now,
        });
        return { handled: true, alreadyProcessed: false, shipmentId: shipment.legacyId, orderId: order.legacyId, status: mappedStatus };
    },
});

async function payoutItemsForOrder(ctx: ReadCtx, order: OrderDoc) {
    const items = await ctx.db
        .query('orderItems')
        .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
        .collect();
    const payoutItems: Array<{
        shopId: string;
        shopName: string;
        shopSlug: string;
        stripeAccountId: string;
        quantity: number;
        unitPrice: number;
        shippingCost: number;
    }> = [];

    for (const item of items) {
        const resolved = item.variantId
            ? await variantProductAndShop(ctx, (await ctx.db.get(item.variantId))?.legacyId ?? item.variantLegacyId ?? '')
            : item.variantLegacyId ? await variantProductAndShop(ctx, item.variantLegacyId) : null;
        if (!resolved) throw new Error('Payout variant is unavailable');
        const paymentAccount = await paymentAccountForShop(ctx, resolved.shop);
        if (!paymentAccount?.stripeAccountId) throw new Error('Seller payment account is unavailable');
        payoutItems.push({
            shopId: resolved.shop.legacyId,
            shopName: resolved.shop.name,
            shopSlug: resolved.shop.slug,
            stripeAccountId: paymentAccount.stripeAccountId,
            quantity: item.quantity,
            unitPrice: item.priceAtPurchaseCents / 100,
            shippingCost: (item.shippingCostAtPurchaseCents ?? resolved.variant.shippingCostCents ?? 0) / 100,
        });
    }
    return payoutItems;
}

export const listAutoConfirmCandidates = query({
    args: { secret: v.string(), cutoff: v.number() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const orders = await ctx.db
            .query('orders')
            .withIndex('by_status_delivered_at', (q) => q.eq('status', 'delivered'))
            .collect();
        return orders
            .filter((order) => isNewConvexOrder(order) && order.deliveredAt != null && order.deliveredAt < args.cutoff && order.fundsReleasedAt == null)
            .map((order) => ({ orderId: order.legacyId, publicId: order.publicId, stripePaymentIntentId: order.stripePaymentIntentId ?? null }));
    },
});

export const listFailedFundReleaseCandidates = query({
    args: { secret: v.string() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        return (await ctx.db.query('orders').collect())
            .filter((order) => isNewConvexOrder(order) && order.fundsReleaseStatus === 'failed')
            .map((order) => ({ orderId: order.legacyId, publicId: order.publicId, stripePaymentIntentId: order.stripePaymentIntentId ?? null }));
    },
});

export const getPayoutOrder = query({
    args: { secret: v.string(), orderId: v.string() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const order = await ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.orderId))
            .unique();
        if (!order || !isNewConvexOrder(order)) throw new Error('Payout order not found');
        const shipments = await ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();
        const labelCostByShop: Record<string, number> = {};
        if (order.shopLegacyId && shipments[0]?.priceCents != null) {
            labelCostByShop[order.shopLegacyId] = shipments[0].priceCents / 100;
        }
        return {
            id: order.legacyId,
            publicId: order.publicId,
            stripePaymentIntentId: order.stripePaymentIntentId ?? null,
            items: await payoutItemsForOrder(ctx, order),
            labelCostByShop,
        };
    },
});

export const autoConfirmDelivered = mutation({
    args: { secret: v.string(), orderId: v.string(), cutoff: v.number() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const order = await ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.orderId))
            .unique();
        if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
        if (order.status !== 'delivered' || order.deliveredAt == null || order.deliveredAt >= args.cutoff || order.fundsReleasedAt != null) {
            return { confirmed: false, orderId: order.legacyId, publicId: order.publicId };
        }
        await ctx.db.patch(order._id, { status: 'confirmed', fundsReleasedAt: Date.now() });
        return { confirmed: true, orderId: order.legacyId, publicId: order.publicId };
    },
});

export const recordFundsRelease = mutation({
    args: {
        secret: v.string(),
        orderId: v.string(),
        success: v.boolean(),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const order = await ctx.db
            .query('orders')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.orderId))
            .unique();
        if (!order || !isNewConvexOrder(order)) throw new Error('Order not found');
        if (args.success) {
            await ctx.db.patch(order._id, {
                fundsReleaseStatus: 'released',
                fundsReleaseLastError: '',
            });
        } else {
            await ctx.db.patch(order._id, {
                fundsReleaseStatus: 'failed',
                fundsReleaseLastError: args.error ?? 'fund_release_failed',
            });
        }
        return { success: args.success, orderId: order.legacyId };
    },
});

async function notificationContext(ctx: ReadCtx, orderId: string) {
    const order = await ctx.db
        .query('orders')
        .withIndex('by_legacy_id', (q) => q.eq('legacyId', orderId))
        .unique();
    if (!order || !isNewConvexOrder(order)) return null;

    const shop = order.shopId
        ? await ctx.db.get(order.shopId)
        : order.shopLegacyId ? await shopByLegacyId(ctx, order.shopLegacyId) : null;
    const buyer = order.buyerId
        ? await ctx.db.get(order.buyerId)
        : order.buyerLegacyId
            ? await ctx.db.query('profiles').withIndex('by_legacy_id', (q) => q.eq('legacyId', order.buyerLegacyId!)).unique()
            : null;
    const owner = shop?.ownerId
        ? await ctx.db.get(shop.ownerId)
        : shop?.ownerLegacyId
            ? await ctx.db.query('profiles').withIndex('by_legacy_id', (q) => q.eq('legacyId', shop.ownerLegacyId)).unique()
            : null;
    const shipments = await ctx.db.query('shipments').withIndex('by_order_id', (q) => q.eq('orderId', order._id)).collect();

    return {
        orderId: order.legacyId,
        orderPublicId: order.publicId,
        buyerEmail: order.buyerEmail ?? buyer?.email ?? null,
        buyerLegacyId: order.buyerLegacyId ?? buyer?.legacyId ?? null,
        sellerEmail: owner?.email ?? shop?.contactEmail ?? null,
        sellerLegacyId: shop?.ownerLegacyId ?? owner?.legacyId ?? null,
        shopName: shop?.name ?? null,
        pickupPointName: order.pickupPointName ?? null,
        trackingUrl: shipments[0]?.trackingUrl ?? null,
    };
}

export const claimNotification = mutation({
    args: {
        secret: v.string(),
        orderId: v.string(),
        type: v.string(),
        recipient: v.union(v.literal('buyer'), v.literal('seller')),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const context = await notificationContext(ctx, args.orderId);
        if (!context) return { claimed: false, reason: 'order_not_found' as const };

        const existing = await ctx.db
            .query('notificationLog')
            .withIndex('by_order_legacy_type', (q) => q.eq('orderLegacyId', args.orderId).eq('type', args.type))
            .unique();
        if (existing) return { claimed: false, reason: 'already_sent' as const };

        const recipientUserLegacyId = args.recipient === 'buyer' ? context.buyerLegacyId : context.sellerLegacyId;
        const notificationId = await ctx.db.insert('notificationLog', {
            legacyId: `convex:notification:${args.orderId}:${args.type}`,
            orderLegacyId: args.orderId,
            type: args.type,
            ...(recipientUserLegacyId ? { recipientUserLegacyId } : {}),
            createdAt: Date.now(),
        });
        return {
            claimed: true,
            notificationId: String(notificationId),
            recipientEmail: args.recipient === 'buyer' ? context.buyerEmail : context.sellerEmail,
            recipientUserLegacyId,
            orderPublicId: context.orderPublicId,
            shopName: context.shopName,
            pickupPointName: context.pickupPointName,
            trackingUrl: context.trackingUrl,
        };
    },
});

export const completeNotification = mutation({
    args: {
        secret: v.string(),
        notificationId: v.string(),
        emailStatus: v.string(),
        pushStatus: v.string(),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const notification = await ctx.db.get(args.notificationId as never);
        if (!notification) return { updated: false };
        await ctx.db.patch(notification._id, { emailStatus: args.emailStatus, pushStatus: args.pushStatus });
        return { updated: true };
    },
});

export const listNotificationPushSubscriptions = query({
    args: { secret: v.string(), userLegacyId: v.string() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        return await ctx.db
            .query('pushSubscriptions')
            .withIndex('by_user_legacy_id', (q) => q.eq('userLegacyId', args.userLegacyId))
            .collect();
    },
});

export const deleteNotificationPushSubscription = mutation({
    args: { secret: v.string(), subscriptionLegacyId: v.string() },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const subscription = await ctx.db
            .query('pushSubscriptions')
            .withIndex('by_legacy_id', (q) => q.eq('legacyId', args.subscriptionLegacyId))
            .unique();
        if (subscription) await ctx.db.delete(subscription._id);
        return { deleted: subscription !== null };
    },
});

function isPickupReadyStatus(status: string): boolean {
    const lower = status.toLowerCase();
    return [
        'ready to be picked up',
        'delivered to service point',
        'available for pickup',
        'awaiting customer pickup',
        'ready for pickup',
    ].some((pattern) => lower.includes(pattern));
}

export const notificationScanCandidates = query({
    args: {
        secret: v.string(),
        trackingCutoff: v.number(),
        labelCutoff: v.number(),
    },
    handler: async (ctx, args) => {
        assertWebhookSecret(args.secret);
        const recentTracking = await ctx.db.query('shipmentTracking').collect();
        const outForDelivery: string[] = [];
        const pickupReady: string[] = [];
        for (const event of recentTracking) {
            if (event.createdAt < args.trackingCutoff) continue;
            const shipment = event.shipmentId
                ? await ctx.db.get(event.shipmentId)
                : await ctx.db.query('shipments').withIndex('by_legacy_id', (q) => q.eq('legacyId', event.shipmentLegacyId)).unique();
            if (!shipment) continue;
            const order = shipment.orderId
                ? await ctx.db.get(shipment.orderId)
                : await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', shipment.orderLegacyId)).unique();
            if (!order || !isNewConvexOrder(order)) continue;
            const status = event.status.toLowerCase();
            if (status.includes('out for delivery')) outForDelivery.push(order.legacyId);
            if (isPickupReadyStatus(event.status) && order.deliveryType === 'pickup_point') pickupReady.push(order.legacyId);
        }

        const logs = await ctx.db.query('notificationLog').collect();
        const pickupReadyLog = new Map<string, number>();
        for (const log of logs) {
            if (log.type === 'buyer_pickup_ready' && log.orderLegacyId) pickupReadyLog.set(log.orderLegacyId, log.createdAt);
        }

        const pickupReminder: Array<{ orderId: string; createdAt: number }> = [];
        for (const [orderId, createdAt] of pickupReadyLog) {
            const order = await ctx.db.query('orders').withIndex('by_legacy_id', (q) => q.eq('legacyId', orderId)).unique();
            if (order?.status === 'shipped' && order.deliveryType === 'pickup_point') pickupReminder.push({ orderId, createdAt });
        }

        const orders = await ctx.db.query('orders').collect();
        const labelReminder: string[] = [];
        const shipReminder: Array<{ orderId: string; paidAt: number }> = [];
        for (const order of orders) {
            if (!isNewConvexOrder(order)) continue;
            if (order.status === 'paid' && order.paidAt != null && order.paidAt < args.labelCutoff) labelReminder.push(order.legacyId);
            if (order.status === 'processing' && order.paidAt != null) shipReminder.push({ orderId: order.legacyId, paidAt: order.paidAt });
        }

        return {
            outForDelivery: [...new Set(outForDelivery)],
            pickupReady: [...new Set(pickupReady)],
            pickupReminder,
            labelReminder,
            shipReminder,
        };
    },
});
