import type { Product, Shop } from '../core/types';
import { SHOP_STATUS } from '../core/shopStatus';
import { isProductComplete } from './productValidation';
import { getDefaultVariant, isInStock } from './variants';

/**
 * Serializer for the public, read-only shop catalog feed
 * (`/api/public/shops/[shopSlug]/catalog.json`).
 *
 * It exists so a seller's own site can mirror their Fewya listings without
 * being handed database credentials. Everything it emits is already visible on
 * the public product page — deliberately including no exact stock counts, no
 * internal ids beyond the product uuid, and nothing about orders or payouts.
 */

export const PUBLIC_CATALOG_VERSION = 1;

export interface PublicCatalogProduct {
    /** Stable id: lets consumers keep a mapping even if the slug is edited. */
    id: string;
    slug: string;
    title: string;
    description: string | null;
    brand: string | null;
    category: string | null;
    images: string[];
    specifications: Record<string, unknown>;
    price: number;
    currency: 'EUR';
    /** Boolean on purpose — exact inventory levels are not public data. */
    in_stock: boolean;
    url: string;
    created_at: string;
}

export interface PublicCatalogShop {
    slug: string;
    name: string;
    url: string;
}

export interface PublicCatalog {
    version: number;
    generated_at: string;
    shop: PublicCatalogShop;
    products: PublicCatalogProduct[];
}

/** A shop is only exposed when buyers could actually reach and pay it. */
export function isShopPubliclyVisible(shop: Pick<Shop, 'is_active' | 'status' | 'payments_active' | 'seller_details_complete'> | null | undefined): boolean {
    return Boolean(
        shop &&
        shop.is_active &&
        shop.status === SHOP_STATUS.ACTIVE &&
        shop.payments_active &&
        shop.seller_details_complete
    );
}

function serializeProduct(product: Product, shopSlug: string, origin: string): PublicCatalogProduct {
    const variant = getDefaultVariant(product.variants);

    return {
        id: product.id,
        slug: product.slug,
        title: product.title,
        description: product.description,
        brand: product.brand,
        category: product.category,
        images: product.gallery_images ?? [],
        specifications: product.specifications ?? {},
        price: variant?.price ?? 0,
        currency: 'EUR',
        in_stock: isInStock(product.variants),
        url: `${origin}/${shopSlug}/${product.slug}`,
        created_at: product.created_at,
    };
}

/**
 * Builds the feed payload. Out-of-stock products are intentionally kept: a
 * mirror site needs them to keep the corresponding URL alive instead of
 * letting it 404 every time inventory runs out. Incomplete or deactivated
 * products are dropped, matching what the storefront itself will render.
 */
export function buildPublicCatalog(
    shop: Shop,
    products: Product[],
    origin: string,
    now: Date = new Date()
): PublicCatalog {
    const visible = products
        .filter(p => p.is_active && isProductComplete(p))
        .sort((a, b) => a.slug.localeCompare(b.slug));

    return {
        version: PUBLIC_CATALOG_VERSION,
        generated_at: now.toISOString(),
        shop: {
            slug: shop.slug,
            name: shop.name,
            url: `${origin}/${shop.slug}`,
        },
        products: visible.map(p => serializeProduct(p, shop.slug, origin)),
    };
}
