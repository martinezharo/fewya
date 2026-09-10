import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { storageMarker } from './storageMarker';

type AccessCtx = QueryCtx | MutationCtx;

/**
 * Decides whether a profile may resolve a Convex Storage object to a URL.
 *
 * Holding the storage ID proves nothing: IDs travel in markers, API responses
 * and page URLs, and the same store holds shipping labels — which carry the
 * buyer's name and address — next to public product images. So access is
 * granted only by a document that ties the object to this profile:
 *
 * - the upload it recorded when the file arrived;
 * - its own avatar;
 * - the images of a shop it owns, and of that shop's products and variants;
 * - the label of a shipment, or the photos of an incident, on an order where
 *   it is the buyer or the seller.
 *
 * Public product images are resolved by the catalog queries, which run with no
 * session at all, so nothing here needs to answer for anonymous callers.
 */
export async function mayAccessStorageObject(
    ctx: AccessCtx,
    storageId: Id<'_storage'>,
    profile: Doc<'profiles'>,
): Promise<boolean> {
    const marker = storageMarker(String(storageId));

    const upload = await ctx.db
        .query('storageUploads')
        .withIndex('by_storage_id', (q) => q.eq('storageId', storageId))
        .unique();
    if (upload && (upload.ownerId === profile._id || upload.ownerLegacyId === profile.legacyId)) return true;

    if (profile.avatarUrl === marker) return true;

    if (await ownsSellerAsset(ctx, marker, profile)) return true;
    if (await participatesInOrderAsset(ctx, marker, profile)) return true;

    return false;
}

/** Shop banners and avatars, product galleries and variant images. */
async function ownsSellerAsset(ctx: AccessCtx, marker: string, profile: Doc<'profiles'>): Promise<boolean> {
    for (const shop of await shopsOwnedBy(ctx, profile)) {
        if (shop.profileImg === marker || shop.bannerImg === marker) return true;

        for (const product of await productsOfShop(ctx, shop)) {
            if (product.galleryImages.includes(marker)) return true;

            const variants = await withLegacyFallback(
                ctx.db.query('productVariants').withIndex('by_product_id', (q) => q.eq('productId', product._id)).collect(),
                ctx.db.query('productVariants').withIndex('by_product_legacy_id', (q) => q.eq('productLegacyId', product.legacyId)).collect(),
            );
            if (variants.some((variant) => variant.variantImage === marker)) return true;
        }
    }
    return false;
}

/** Shipping labels and incident photos of the caller's own orders. */
async function participatesInOrderAsset(ctx: AccessCtx, marker: string, profile: Doc<'profiles'>): Promise<boolean> {
    const orders = await ordersInvolving(ctx, profile);

    for (const order of orders) {
        const shipments = await ctx.db
            .query('shipments')
            .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
            .collect();
        if (shipments.some((shipment) => shipment.labelUrl === marker)) return true;

        const incidents = await ctx.db
            .query('orderIncidents')
            .withIndex('by_order_id', (q) => q.eq('orderId', order._id))
            .collect();
        if (incidents.some((incident) => incident.photos.includes(marker))) return true;
    }
    return false;
}

/** Every order the profile can already read: as its buyer or as its seller. */
async function ordersInvolving(ctx: AccessCtx, profile: Doc<'profiles'>): Promise<Doc<'orders'>[]> {
    const found = new Map<string, Doc<'orders'>>();

    for (const order of await ctx.db.query('orders').withIndex('by_buyer_id', (q) => q.eq('buyerId', profile._id)).collect()) {
        found.set(String(order._id), order);
    }

    for (const shop of await shopsOwnedBy(ctx, profile)) {
        for (const order of await ctx.db.query('orders').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect()) {
            found.set(String(order._id), order);
        }
    }

    return [...found.values()];
}

async function shopsOwnedBy(ctx: AccessCtx, profile: Doc<'profiles'>): Promise<Doc<'shops'>[]> {
    return await withLegacyFallback(
        ctx.db.query('shops').withIndex('by_owner_id', (q) => q.eq('ownerId', profile._id)).collect(),
        ctx.db.query('shops').withIndex('by_owner_legacy_id', (q) => q.eq('ownerLegacyId', profile.legacyId)).collect(),
    );
}

async function productsOfShop(ctx: AccessCtx, shop: Doc<'shops'>): Promise<Doc<'products'>[]> {
    return await withLegacyFallback(
        ctx.db.query('products').withIndex('by_shop_id', (q) => q.eq('shopId', shop._id)).collect(),
        ctx.db.query('products').withIndex('by_shop_legacy_id', (q) => q.eq('shopLegacyId', shop.legacyId)).collect(),
    );
}

/**
 * Imported rows are linked by Supabase UUID until the importer resolves them
 * to document IDs, so both indexes are read and the results de-duplicated.
 */
async function withLegacyFallback<T extends { _id: { toString(): string } }>(
    byId: Promise<T[]>,
    byLegacyId: Promise<T[]>,
): Promise<T[]> {
    const rows = [...(await byId), ...(await byLegacyId)];
    return [...new Map(rows.map((row) => [String(row._id), row])).values()];
}
