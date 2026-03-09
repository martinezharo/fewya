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
    shop?: Shop;
    variants?: ProductVariant[];
}

export interface ProductVariant {
    id: string;
    product_id: string;
    sku: string | null;
    price: number;
    stock: number;
    attributes: Record<string, any>;
    variant_image: string | null;
    created_at: string;
}
