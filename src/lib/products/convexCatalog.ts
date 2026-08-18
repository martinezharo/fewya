import { api } from '../../../convex/_generated/api';
import { createConvexClient } from '../core/convex';
import type { Product, ProductVariant, Review, Shop } from '../core/types';
import type { SearchParams } from './search';

interface ConvexShop {
    id: string;
    owner_id: string;
    slug: string;
    name: string;
    description: string | null;
    profile_img: string | null;
    banner_img: string | null;
    contact_email: string | null;
    whatsapp: string | null;
    is_active: boolean;
    status: Shop['status'];
    created_at: string;
    accent_color: string | null;
    location: string | null;
    default_weight_kg: number | null;
    default_length_cm: number | null;
    default_width_cm: number | null;
    default_height_cm: number | null;
    default_shipping_cost: number | null;
    payments_active: boolean;
    seller_details_complete: boolean;
    allow_loss: boolean;
    shipping_carriers: Shop['shipping_carriers'];
}

interface ConvexVariant {
    id: string;
    product_id: string;
    variant_name: string | null;
    price: number;
    stock: number;
    attributes: Record<string, unknown>;
    variant_image: string | null;
    created_at: string;
    is_default: boolean;
    weight_kg: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    shipping_cost: number | null;
}

interface ConvexProduct {
    id: string;
    shop_id: string;
    title: string;
    description: string | null;
    category: string | null;
    gallery_images: string[];
    is_active: boolean;
    created_at: string;
    brand: string | null;
    specifications: Record<string, unknown>;
    slug: string;
    shop?: ConvexShop;
    variants?: ConvexVariant[];
    review_avg?: number;
    review_count?: number;
}

interface ConvexReview {
    id: string;
    product_id: string;
    profile_id: string | null;
    rating: number;
    comment: string | null;
    seller_reply: string | null;
    seller_reply_at: string | null;
    created_at: string;
    is_auto: boolean;
    profile?: { full_name: string | null; avatar_url: string | null };
}

interface ConvexProductPage extends ConvexProduct {
    reviews: ConvexReview[];
}

export interface ConvexShopCatalog {
    shop: ConvexShop;
    products: ConvexProduct[];
    totalReviews: number;
    averageRating: number;
}

function toShop(shop: ConvexShop): Shop {
    return {
        id: shop.id,
        owner_id: shop.owner_id,
        name: shop.name,
        slug: shop.slug,
        description: shop.description,
        profile_img: shop.profile_img,
        banner_img: shop.banner_img,
        contact_email: shop.contact_email,
        whatsapp: shop.whatsapp,
        is_active: shop.is_active,
        created_at: shop.created_at,
        accent_color: shop.accent_color,
        location: shop.location,
        default_weight_kg: shop.default_weight_kg,
        default_length_cm: shop.default_length_cm,
        default_width_cm: shop.default_width_cm,
        default_height_cm: shop.default_height_cm,
        default_shipping_cost: shop.default_shipping_cost,
        payments_active: shop.payments_active,
        seller_details_complete: shop.seller_details_complete,
        allow_loss: shop.allow_loss,
        status: shop.status,
        shipping_carriers: shop.shipping_carriers,
    };
}

function toVariant(variant: ConvexVariant): ProductVariant {
    return {
        id: variant.id,
        product_id: variant.product_id,
        variant_name: variant.variant_name,
        price: variant.price,
        stock: variant.stock,
        attributes: variant.attributes,
        variant_image: variant.variant_image,
        created_at: variant.created_at,
        is_default: variant.is_default,
        weight_kg: variant.weight_kg,
        length_cm: variant.length_cm,
        width_cm: variant.width_cm,
        height_cm: variant.height_cm,
        shipping_cost: variant.shipping_cost,
    };
}

export function toProduct(product: ConvexProduct): Product {
    return {
        id: product.id,
        shop_id: product.shop_id,
        title: product.title,
        description: product.description,
        category: product.category,
        gallery_images: product.gallery_images,
        is_active: product.is_active,
        created_at: product.created_at,
        brand: product.brand,
        specifications: product.specifications,
        slug: product.slug,
        shop: product.shop ? toShop(product.shop) : undefined,
        variants: (product.variants ?? []).map(toVariant),
        review_avg: product.review_avg,
        review_count: product.review_count,
    };
}

export async function getConvexHomeProducts(limit = 80): Promise<Product[] | null> {
    const client = createConvexClient();
    if (!client) return null;
    try {
        const rows = await client.query(api.catalog.listHomeProducts, { limit }) as unknown as ConvexProduct[];
        return rows.map(toProduct);
    } catch (error) {
        console.error('Convex home catalog unavailable:', error);
        return null;
    }
}

export async function getConvexPublicShops(limit = 12): Promise<Array<Pick<Shop, 'slug' | 'name' | 'profile_img'>> | null> {
    const client = createConvexClient();
    if (!client) return null;
    try {
        return await client.query(api.catalog.listPublicShops, { limit }) as unknown as Array<Pick<Shop, 'slug' | 'name' | 'profile_img'>>;
    } catch (error) {
        console.error('Convex shop list unavailable:', error);
        return null;
    }
}

export async function getConvexSearchProducts(params: SearchParams): Promise<Product[] | null> {
    const client = createConvexClient();
    if (!client) return null;
    try {
        const rows = await client.query(api.catalog.searchProducts, {
            query: params.q,
            minPrice: params.minPrice ?? undefined,
            maxPrice: params.maxPrice != null && params.maxPrice < 500 ? params.maxPrice : undefined,
            showOos: params.showOos,
            sort: params.sort,
            dir: params.dir,
            limit: 80,
        }) as unknown as ConvexProduct[];
        return rows.map(toProduct);
    } catch (error) {
        console.error('Convex product search unavailable:', error);
        return null;
    }
}

export async function getConvexShopCatalog(slug: string): Promise<{
    shop: Shop;
    products: Product[];
    totalReviews: number;
    averageRating: number;
} | null> {
    const client = createConvexClient();
    if (!client) return null;
    try {
        const result = await client.query(api.catalog.getShopCatalog, { slug }) as unknown as ConvexShopCatalog | null;
        if (!result) return null;
        return {
            shop: toShop(result.shop),
            products: result.products.map(toProduct),
            totalReviews: result.totalReviews,
            averageRating: result.averageRating,
        };
    } catch (error) {
        console.error('Convex shop catalog unavailable:', error);
        return null;
    }
}

export async function getConvexProduct(shopSlug: string, productSlug: string): Promise<{ product: Product; reviews: Review[] } | null> {
    const client = createConvexClient();
    if (!client) return null;
    try {
        const result = await client.query(api.catalog.getProduct, { shopSlug, productSlug }) as unknown as ConvexProductPage | null;
        if (!result) return null;
        return {
            product: toProduct(result),
            reviews: result.reviews.map((review) => ({
                id: review.id,
                product_id: review.product_id,
                profile_id: review.profile_id,
                rating: review.rating,
                comment: review.comment,
                seller_reply: review.seller_reply,
                seller_reply_at: review.seller_reply_at,
                created_at: review.created_at,
                is_auto: review.is_auto,
                profile: review.profile,
            })),
        };
    } catch (error) {
        console.error('Convex product unavailable:', error);
        return null;
    }
}

export async function getConvexProductsByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const client = createConvexClient();
    if (!client) return [];
    try {
        const rows = await client.query(api.catalog.getProductsByLegacyIds, { ids }) as unknown as ConvexProduct[];
        return rows.map(toProduct);
    } catch (error) {
        console.error('Convex wishlist products unavailable:', error);
        return [];
    }
}
