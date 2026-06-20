import type { OrderStatus, PaymentStatus, FundsReleaseStatus, DeliveryType } from '../orders/orderStatus';
import type { ShipmentStatus } from '../shipping/shipmentStatus';
import type { ShopStatus } from './shopStatus';
import type { ShippingPlatform } from '../shipping/shippingPlatform';

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
    payments_active: boolean;
    seller_details_complete: boolean;
    allow_loss: boolean;
    status: ShopStatus;
    shipping_carriers: ShippingPlatform[];
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
    profile_id: string | null;
    rating: number;
    comment: string | null;
    seller_reply: string | null;
    seller_reply_at: string | null;
    created_at: string;
    is_auto?: boolean;
    profile?: {
        full_name: string | null;
        avatar_url: string | null;
    };
}

export interface Order {
    id: string;
    public_id: string;
    checkout_group_id: string | null;
    buyer_id: string | null;
    shop_id: string | null;
    status: OrderStatus;
    payment_status: PaymentStatus;
    total_amount: number;
    currency: string;
    has_insurance: boolean;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
    paid_at: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    funds_released_at: string | null;
    cancellation_reason: string | null;
    buyer_hidden_at: string | null;
    funds_release_status: FundsReleaseStatus;
    funds_release_last_error: string | null;
    buyer_email: string | null;
    shipping_full_name: string | null;
    shipping_phone: string | null;
    shipping_address: string | null;
    delivery_type: DeliveryType | null;
    pickup_point_id: string | null;
    pickup_point_name: string | null;
    pickup_point_address: string | null;
    pickup_point_postal_code: string | null;
    pickup_point_city: string | null;
    pickup_point_carrier: string | null;
    created_at: string;
}

export interface Shipment {
    id: string;
    order_id: string;
    sendcloud_shipment_id: string | null;
    sendcloud_reference: string | null;
    carrier_id: string | null;
    carrier_name: string | null;
    service_name: string | null;
    status: ShipmentStatus;
    tracking_number: string | null;
    tracking_url: string | null;
    price: number | null;
    currency: string | null;
    label_url: string | null;
    requested_at: string | null;
    created_at: string;
    updated_at: string;
}
