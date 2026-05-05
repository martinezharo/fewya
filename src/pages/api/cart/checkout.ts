import type { APIRoute } from 'astro';
import {
    buildShopPayouts,
    CHECKOUT_CURRENCY,
    type CheckoutResolvedItem,
    toMinorUnits,
} from '../../../lib/checkout';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';
import { validateCheckoutReadiness } from '../../../lib/productValidation';
import { buildAbsoluteUrl, getStripeClient } from '../../../lib/stripe';

interface CheckoutItemPayload {
    variantId: string;
    quantity: number;
}

interface DeliveryPayload {
    type: 'home' | 'pickup_point';
    pickupPointId?: string;
    pickupPointName?: string;
    pickupPointAddress?: string;
    pickupPointPostalCode?: string;
    pickupPointCity?: string;
    pickupPointCarrier?: string;
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

function normalizeItems(items: CheckoutItemPayload[]) {
    const combined = new Map<string, number>();

    for (const item of items) {
        if (!item.variantId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
            return null;
        }

        combined.set(item.variantId, (combined.get(item.variantId) ?? 0) + item.quantity);
    }

    return Array.from(combined.entries()).map(([variantId, quantity]) => ({ variantId, quantity }));
}

function buildStripeLineItems(items: CheckoutResolvedItem[]) {
    const lineItems = items.map((item) => ({
        quantity: item.quantity,
        price_data: {
            currency: CHECKOUT_CURRENCY,
            unit_amount: toMinorUnits(item.unitPrice),
            product_data: {
                name: item.productTitle,
                description: item.variantName ?? undefined,
                metadata: {
                    productId: item.productId,
                    variantId: item.variantId,
                    shopId: item.shopId,
                    type: 'product',
                },
            },
        },
    }));

    for (const payout of buildShopPayouts(items)) {
        lineItems.push({
            quantity: 1,
            price_data: {
                currency: CHECKOUT_CURRENCY,
                unit_amount: toMinorUnits(payout.shipping),
                product_data: {
                    name: `${strings.cartShipping} · ${payout.shopName}`,
                    description: undefined,
                    metadata: {
                        productId: '',
                        variantId: '',
                        shopId: payout.shopId,
                        type: 'shipping',
                    },
                },
            },
        });
    }

    return lineItems;
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    let body: { items: CheckoutItemPayload[]; delivery?: DeliveryPayload };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: strings.apiInvalidBody }, 400);
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
        return jsonResponse({ error: strings.apiCartEmpty }, 400);
    }

    const normalizedItems = normalizeItems(body.items);
    if (!normalizedItems) {
        return jsonResponse({ error: strings.apiInvalidProductData }, 400);
    }

    const { data: profile } = await authClient
        .from('profiles')
        .select('first_name, last_name, email, phone, phone_prefix, address_street, address_number, address_floor, address_postal_code, address_city, address_province, address_country')
        .eq('id', user.id)
        .single();

    const firstName = profile?.first_name?.trim() || user.user_metadata?.full_name?.trim() || null;
    const lastName = profile?.last_name?.trim() || null;
    const shippingFullName = [firstName, lastName].filter(Boolean).join(' ') || null;
    const shippingPhone = [(profile as any)?.phone_prefix || '+34', profile?.phone?.trim()].filter(Boolean).join(' ') || null;

    const street = profile?.address_street?.trim() || '';
    const number = profile?.address_number?.trim() || '';
    const floor = profile?.address_floor?.trim() || '';
    const postalCode = profile?.address_postal_code?.trim() || '';
    const city = profile?.address_city?.trim() || '';
    const province = profile?.address_province?.trim() || '';
    const country = profile?.address_country?.trim() || 'ES';

    const addressParts = [
        street && number ? `${street} ${number}` : street,
        floor,
        postalCode ? `${postalCode} ${city}` : city,
        province,
        country !== 'ES' ? country : null,
    ].filter(Boolean);

    const shippingAddress = addressParts.length > 0 ? addressParts.join(', ') : null;
    const buyerEmail = user.email || profile?.email || null;

    if (!shippingFullName || !shippingAddress) {
        const redirectParams = new URLSearchParams({
            checkout: '1',
            return_to: '/cart',
        });

        return jsonResponse({
            error: strings.apiProfileIncomplete,
            redirectTo: `/me/details?${redirectParams.toString()}`,
        }, 400);
    }

    const variantIds = normalizedItems.map((item) => item.variantId);
    const { data: variantRows, error: variantsError } = await authClient
        .from('product_variants')
        .select(`
            id,
            price,
            stock,
            variant_name,
            variant_image,
            shipping_cost,
            products!inner (
                id,
                title,
                slug,
                is_active,
                gallery_images,
                shops!inner (
                    id,
                    name,
                    slug,
                    is_active,
                    shop_payment_accounts (
                        stripe_account_id,
                        charges_enabled,
                        payouts_enabled,
                        details_submitted
                    )
                )
            )
        `)
        .in('id', variantIds);

    if (variantsError) {
        console.error('checkout variant lookup failed', variantsError);
        return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 500);
    }

    const variantMap = new Map((variantRows ?? []).map((variant: any) => [variant.id as string, variant]));
    const resolvedItems: CheckoutResolvedItem[] = [];

    for (const item of normalizedItems) {
        const variant = variantMap.get(item.variantId);
        const product = one(variant?.products as any);
        const shop = one(product?.shops as any);
        const paymentAccount = one(shop?.shop_payment_accounts as any);

        if (!variant || !product || !shop) {
            return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 400);
        }

        if (!product.is_active || !shop.is_active) {
            return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 400);
        }

        const checkoutCheck = validateCheckoutReadiness(product, variant, item.quantity);
        if (!checkoutCheck.ready) {
            if (checkoutCheck.reason === 'out_of_stock') {
                return jsonResponse({ error: strings.apiCheckoutOutOfStock }, 400);
            }
            return jsonResponse({ error: strings.apiCheckoutProductUnavailable }, 400);
        }

        const stock = Number(variant.stock ?? 0);
        if (item.quantity > stock) {
            return jsonResponse({ error: strings.apiCheckoutOutOfStock }, 400);
        }

        if (!paymentAccount?.stripe_account_id || !paymentAccount.charges_enabled || !paymentAccount.payouts_enabled || !paymentAccount.details_submitted) {
            return jsonResponse({ error: strings.apiCheckoutSellerNotReady }, 400);
        }

        resolvedItems.push({
            productId: product.id,
            productTitle: product.title,
            productSlug: product.slug,
            variantId: variant.id,
            variantName: variant.variant_name ?? null,
            image: variant.variant_image || product.gallery_images?.[0] || null,
            quantity: item.quantity,
            unitPrice: Number(variant.price ?? 0),
            shippingCost: Number(variant.shipping_cost ?? 0),
            shopId: shop.id,
            shopName: shop.name,
            shopSlug: shop.slug,
            stripeAccountId: paymentAccount.stripe_account_id,
        });
    }

    const checkoutGroupId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const stripe = getStripeClient();
    const successUrl = `${buildAbsoluteUrl(request, '/cart/success')}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = buildAbsoluteUrl(request, '/cart/cancel');

    let session;
    try {
        session = await stripe.checkout.sessions.create({
            mode: 'payment',
            locale: 'es',
            line_items: buildStripeLineItems(resolvedItems),
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer_email: buyerEmail ?? undefined,
            payment_intent_data: {
                transfer_group: `order_${checkoutGroupId}`,
                metadata: {
                    buyerId: user.id,
                    checkoutGroupId,
                },
            },
            metadata: {
                buyerId: user.id,
                checkoutGroupId,
            },
        });
    } catch (error) {
        console.error('stripe checkout session creation failed', error);

        const message = error instanceof Error ? error.message : strings.apiCheckoutSessionError;
        const normalizedMessage = message === strings.authMissingStripeEnv ? message : strings.apiCheckoutSessionError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }

    if (!session.url) {
        return jsonResponse({ error: strings.apiCheckoutSessionError }, 500);
    }

    // Group items by shop and create one order per shop
    const shopGroups = new Map<string, {
        shopId: string;
        shopName: string;
        shopSlug: string;
        stripeAccountId: string;
        items: CheckoutResolvedItem[];
        subtotal: number;
        shipping: number;
    }>();

    for (const item of resolvedItems) {
        const existing = shopGroups.get(item.shopId);
        if (existing) {
            existing.items.push(item);
            existing.subtotal += item.unitPrice * item.quantity;
            existing.shipping = Math.max(existing.shipping, item.shippingCost);
        } else {
            shopGroups.set(item.shopId, {
                shopId: item.shopId,
                shopName: item.shopName,
                shopSlug: item.shopSlug,
                stripeAccountId: item.stripeAccountId,
                items: [item],
                subtotal: item.unitPrice * item.quantity,
                shipping: item.shippingCost,
            });
        }
    }

    const createdOrders: Array<{ id: string; publicId: string; shopId: string }> = [];

    for (const group of shopGroups.values()) {
        const shopPublicId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const shopTotal = group.subtotal + group.shipping;

        const delivery = body.delivery;
        const isPickup = delivery?.type === 'pickup_point';

        const { data: orderData, error: orderError } = await authClient.rpc('create_checkout_order', {
            p_public_id: shopPublicId,
            p_checkout_group_id: checkoutGroupId,
            p_shop_id: group.shopId,
            p_total_amount: shopTotal,
            p_currency: CHECKOUT_CURRENCY,
            p_stripe_checkout_session_id: session.id,
            p_buyer_email: buyerEmail,
            p_shipping_full_name: shippingFullName,
            p_shipping_phone: shippingPhone,
            p_shipping_address: isPickup && delivery?.pickupPointAddress
                ? delivery.pickupPointAddress
                : shippingAddress,
            p_items: group.items.map((item) => ({
                variant_id: item.variantId,
                quantity: item.quantity,
                price_at_purchase: item.unitPrice,
            })),
            p_delivery_type: delivery?.type || 'home',
            p_pickup_point_id: delivery?.pickupPointId || null,
            p_pickup_point_name: delivery?.pickupPointName || null,
            p_pickup_point_address: delivery?.pickupPointAddress || null,
            p_pickup_point_postal_code: delivery?.pickupPointPostalCode || null,
            p_pickup_point_city: delivery?.pickupPointCity || null,
            p_pickup_point_carrier: delivery?.pickupPointCarrier || null,
        });

        if (orderError) {
            console.error('checkout order creation failed for shop', group.shopId, orderError);
            await stripe.checkout.sessions.expire(session.id).catch((expireError) => {
                console.error('failed to expire stripe session after order error', expireError);
            });

            return jsonResponse({ error: strings.apiOrderCreateError }, 500);
        }

        const order = Array.isArray(orderData) ? orderData[0] : orderData;
        if (order?.id) {
            createdOrders.push({
                id: order.id,
                publicId: shopPublicId,
                shopId: group.shopId,
            });
        }
    }

    return jsonResponse({
        checkoutUrl: session.url,
        orders: createdOrders,
        checkoutGroupId,
    }, 200);
};
