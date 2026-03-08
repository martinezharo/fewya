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
}

export interface Product {
    id: string;
    shop_id: string;
    title: string;
    description: string | null;
    category: string | null;
    price: number;
    stock: number;
    images: string[];
    is_active: boolean;
    created_at: string;
    shop?: Shop;
}
