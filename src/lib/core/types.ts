export interface Shop {
    id: string;
    owner_id: string;
    name: string;
    slug: string;
    description: string | null;
    profile_img: string | null;
    banner_img: string | null;
    contact_email: string | null;
    whatsapp: string | null;
    is_active: boolean;
    created_at: string;
    accent_color: string | null;
    location: string | null;
    default_weight_kg: number | null;
    default_length_cm: number | null;
    default_width_cm: number | null;
    default_height_cm: number | null;
    default_shipping_cost: number | null;
}

export interface Product {
    id: string;
    shop_id: string;
    title: string;
    description: string | null;
    category: string | null;
    gallery_images: string[];
    is_active: boolean;
    created_at: string;
    brand: string | null;
    specifications: Record<string, any>;
    slug: string;
    shop?: Shop;
    variants?: ProductVariant[];
    review_avg?: number;
    review_count?: number;
}

export interface ProductVariant {
    id: string;
    product_id: string;
    variant_name: string | null;
    price: number;
    stock: number;
    attributes: Record<string, any>;
    variant_image: string | null;
    created_at: string;
    is_default: boolean;
    weight_kg: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    shipping_cost: number | null;
}

export interface Review {
    id: string;
    product_id: string;
    profile_id: string;
    rating: number;
    comment: string | null;
    seller_reply: string | null;
    seller_reply_at: string | null;
    created_at: string;
    profile?: {
        full_name: string | null;
        avatar_url: string | null;
    };
}
