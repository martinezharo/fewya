import type { APIRoute } from 'astro';
import {
    buildStripeLineItems,
    CHECKOUT_CURRENCY,
    type CheckoutResolvedItem,
    normalizeCheckoutItems,
} from '../../../lib/cart/checkout';
import { createSupabaseAuthClient, getRequestConvexToken } from '../../../lib/core/auth';
import { createSupabaseAdminClient } from '../../../lib/core/supabase-admin';
import { api } from '../../../../convex/_generated/api';
import { createConvexClient } from '../../../lib/core/convex';
import { convexOnly } from '../../../lib/core/env';

import { validateCheckoutReadiness } from '../../../lib/products/productValidation';
import { buildAbsoluteUrl, getStripeClient } from '../../../lib/payments/stripe';
import { isProfileComplete } from '../../../lib/core/validation';
import { resolvePhonePrefix } from '../../../lib/core/phone';
import { pickOne, type JoinedProduct, type JoinedShop, type JoinedVariant, type JoinedPaymentAccount } from '../../../lib/orders/orderJoins';
import { DELIVERY_TYPE, type DeliveryType } from '../../../lib/orders/orderStatus';
import { normalizeShippingPlatforms, platformForDelivery, type ShippingPlatform } from '../../../lib/shipping/shippingPlatform';

interface CheckoutItemPayload {
    variantId: string;
    quantity: number;
}

interface DeliveryPayload {
    type: DeliveryType;
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

export const POST: APIRoute = async ({ locals, request, cookies  }) => {
    const { t } = locals;
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    const convexToken = getRequestConvexToken(request);
    const convex = convexToken ? createConvexClient(convexToken) : null;

    let body: { items: CheckoutItemPayload[]; delivery?: DeliveryPayload };
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: t.apiInvalidBody }, 400);
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
        return jsonResponse({ error: t.apiCartEmpty }, 400);
    }

    const normalizedItems = normalizeCheckoutItems(body.items);
    if (!normalizedItems) {
        return jsonResponse({ error: t.apiInvalidProductData }, 400);
    }

    type CheckoutProfile = {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        phone_prefix: string | null;
        address_street: string | null;
        address_number: string | null;
        address_floor: string | null;
        address_postal_code: string | null;
        address_city: string | null;
        address_province: string | null;
        address_country: string | null;
    };
    type CheckoutVariantRow = JoinedVariant & { id: string };

    let profile: CheckoutProfile | null = null;
    let variantRows: CheckoutVariantRow[] = [];
    let variantsError: { message: string } | null = null;

    if (convexOnly) {
        if (!convex) return jsonResponse({ error: t.apiInternalError }, 503);
        try {
            const current = await convex.query(api.users.current, {});
            if (!current) return jsonResponse({ error: t.apiUnauthorized }, 401);
            profile = {
                first_name: current.firstName ?? null,
                last_name: current.lastName ?? null,
                email: current.email ?? null,
                phone: current.phone ?? null,
                phone_prefix: current.phonePrefix ?? null,
                address_street: current.addressStreet ?? null,
                address_number: current.addressNumber ?? null,
                address_floor: current.addressFloor ?? null,
                address_postal_code: current.addressPostalCode ?? null,
                address_city: current.addressCity ?? null,
                address_province: current.addressProvince ?? null,
                address_country: current.addressCountry ?? null,
            };
            const rows = await convex.query(api.catalog.getCartVariants, {
                ids: normalizedItems.map((item) => item.variantId),
            });
            variantRows = (rows as Array<any>).map((row) => ({
                id: row.id,
                price: row.price,
                stock: row.stock,
                variant_name: row.variant_name,
                variant_image: row.variant_image,
                shipping_cost: row.shipping_cost,
                products: {
                    id: row.product.id,
                    title: row.product.title,
                    slug: row.product.slug,
                    is_active: row.product.is_active,
                    gallery_images: row.product.gallery_images,
                    shops: {
                        id: row.product.shop.id,
                        name: row.product.shop.name,
                        slug: row.product.shop.slug,
                        is_active: row.product.shop.is_active,
                        seller_details_complete: row.product.shop.seller_details_complete,
                        shipping_carriers: row.product.shop.shipping_carriers,
                        shop_payment_accounts: row.product.shop.payment_ready
                            ? {
                                stripe_account_id: 'convex:payment-ready',
                                charges_enabled: true,
                                payouts_enabled: true,
                                details_submitted: true,
                            }
                            : null,
                    },
                },
            } as CheckoutVariantRow));
        } catch (error) {
            variantsError = { message: error instanceof Error ? error.message : String(error) };
        }
    } else {
        const result = await authClient
            .from('profiles')
            .select('first_name, last_name, email, phone, phone_prefix, address_street, address_number, address_floor, address_postal_code, address_city, address_province, address_country')
            .eq('id', user.id)
            .single();
        profile = result.data as CheckoutProfile | null;

        const variantResult = await authClient
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
                        seller_details_complete,
                        shipping_carriers,
                        shop_payment_accounts (
                            stripe_account_id,
                            charges_enabled,
                            payouts_enabled,
                            details_submitted
                        )
                    )
                )
            `)
            .in('id', normalizedItems.map((item) => item.variantId));
        variantRows = (variantResult.data ?? []) as unknown as CheckoutVariantRow[];
        variantsError = variantResult.error ? { message: variantResult.error.message } : null;
    }

    const profileCheck = isProfileComplete(profile ?? {});

    if (!profileCheck.complete) {
        const redirectParams = new URLSearchParams({
            checkout: '1',
            return_to: '/cart',
        });

        return jsonResponse({
            error: t.apiProfileIncomplete,
            redirectTo: `/me/details?${redirectParams.toString()}`,
        }, 400);
    }

    const firstName = profile?.first_name?.trim() || user.user_metadata?.full_name?.trim() || null;
    const lastName = profile?.last_name?.trim() || null;
    const shippingFullName = [firstName, lastName].filter(Boolean).join(' ') || null;
    const phonePrefix = resolvePhonePrefix(profile);
    const phone = profile?.phone?.trim() || null;
    const shippingPhone = phone ? `${phonePrefix} ${phone}` : null;

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

    if (variantsError) {
        console.error(JSON.stringify({
            event: 'checkout.variant_lookup_failed',
            error: variantsError.message,
        }));
        return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 500);
    }

    const variantMap = new Map<string, CheckoutVariantRow>(
        (variantRows ?? []).map((variant) => [variant.id as string, variant as unknown as CheckoutVariantRow])
    );
    const resolvedItems: CheckoutResolvedItem[] = [];
    const shopPlatforms = new Map<string, ShippingPlatform[]>();

    for (const item of normalizedItems) {
        const variant = variantMap.get(item.variantId);
        const product = pickOne<JoinedProduct>(variant?.products ?? null);
        const shop = pickOne<JoinedShop>(product?.shops ?? null);
        const paymentAccount = pickOne<JoinedPaymentAccount>(shop?.shop_payment_accounts ?? null);

        if (!variant || !product || !shop) {
            console.error(JSON.stringify({
                event: 'checkout.product_unavailable',
                variantId: item.variantId,
                reason: !variant ? 'variant_not_found' : !product ? 'product_not_found' : 'shop_not_found',
            }));
            return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 400);
        }

        if (!product.is_active || !shop.is_active) {
            console.error(JSON.stringify({
                event: 'checkout.product_unavailable',
                variantId: item.variantId,
                productId: product.id,
                shopId: shop.id,
                reason: !product.is_active ? 'product_inactive' : 'shop_inactive',
            }));
            return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 400);
        }

        const checkoutCheck = validateCheckoutReadiness(product, variant, item.quantity);
        if (!checkoutCheck.ready) {
            console.error(JSON.stringify({
                event: 'checkout.product_unavailable',
                variantId: item.variantId,
                productId: product.id,
                reason: checkoutCheck.reason,
                price: variant.price,
                stock: variant.stock,
                shipping_cost: variant.shipping_cost,
                quantity: item.quantity,
            }));
            if (checkoutCheck.reason === 'out_of_stock') {
                return jsonResponse({ error: t.apiCheckoutOutOfStock }, 400);
            }
            return jsonResponse({ error: t.apiCheckoutProductUnavailable }, 400);
        }

        const stock = Number(variant.stock ?? 0);
        if (item.quantity > stock) {
            return jsonResponse({ error: t.apiCheckoutOutOfStock }, 400);
        }

        if (!paymentAccount?.stripe_account_id || !paymentAccount.charges_enabled || !paymentAccount.payouts_enabled || !paymentAccount.details_submitted) {
            return jsonResponse({ error: t.apiCheckoutSellerNotReady }, 400);
        }

        if (!shop.seller_details_complete) {
            console.error(JSON.stringify({
                event: 'checkout.seller_details_incomplete',
                shopId: shop.id,
            }));
            return jsonResponse({ error: t.apiCheckoutSellerNotReady }, 400);
        }

        if (!shopPlatforms.has(shop.id)) {
            shopPlatforms.set(shop.id, normalizeShippingPlatforms(shop.shipping_carriers));
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

    // Enforce the seller's enabled shipping platforms: the chosen delivery
    // method must be supported by every shop in the cart.
    const deliveryPlatform = platformForDelivery(
        body.delivery?.type || DELIVERY_TYPE.HOME,
        body.delivery?.pickupPointCarrier,
    );
    if (deliveryPlatform) {
        for (const [shopId, platforms] of shopPlatforms) {
            if (!platforms.includes(deliveryPlatform)) {
                console.error(JSON.stringify({
                    event: 'checkout.carrier_unavailable',
                    shopId,
                    deliveryPlatform,
                    enabled: platforms,
                }));
                return jsonResponse({ error: t.apiCheckoutCarrierUnavailable }, 400);
            }
        }
    }

    const checkoutGroupId = `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const stripe = getStripeClient();
    const successUrl = `${buildAbsoluteUrl(request, '/cart/success')}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = buildAbsoluteUrl(request, '/cart/cancel');

    let session;
    try {
        session = await stripe.checkout.sessions.create({
            mode: 'payment',
            locale: locals.locale === 'es' ? 'es' : 'en',
            line_items: buildStripeLineItems(t, resolvedItems),
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
        console.error(JSON.stringify({
            event: 'checkout.stripe_session_failed',
            buyerId: user.id,
            error: error instanceof Error ? error.message : String(error),
        }));

        const message = error instanceof Error ? error.message : t.apiCheckoutSessionError;
        const normalizedMessage = message === t.authMissingStripeEnv ? message : t.apiCheckoutSessionError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }

    if (!session.url) {
        return jsonResponse({ error: t.apiCheckoutSessionError }, 500);
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

    const delivery = body.delivery;
    if (convex) {
        try {
            const result = await convex.mutation(api.orders.createCheckoutOrders, {
                checkoutGroupId,
                stripeCheckoutSessionId: session.id,
                currency: CHECKOUT_CURRENCY,
                orders: Array.from(shopGroups.values()).map((group) => {
                    const shopPublicId = `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
                    const isPickup = delivery?.type === DELIVERY_TYPE.PICKUP_POINT;
                    return {
                        publicId: shopPublicId,
                        shopLegacyId: group.shopId,
                        totalAmountCents: Math.round((group.subtotal + group.shipping) * 100),
                        ...(buyerEmail ? { buyerEmail } : {}),
                        ...(shippingFullName ? { shippingFullName } : {}),
                        ...(shippingPhone ? { shippingPhone } : {}),
                        ...((isPickup && delivery?.pickupPointAddress) || shippingAddress
                            ? { shippingAddress: isPickup && delivery?.pickupPointAddress ? delivery.pickupPointAddress : shippingAddress! }
                            : {}),
                        deliveryType: delivery?.type || DELIVERY_TYPE.HOME,
                        ...(delivery?.pickupPointId ? { pickupPointId: delivery.pickupPointId } : {}),
                        ...(delivery?.pickupPointName ? { pickupPointName: delivery.pickupPointName } : {}),
                        ...(delivery?.pickupPointAddress ? { pickupPointAddress: delivery.pickupPointAddress } : {}),
                        ...(delivery?.pickupPointPostalCode ? { pickupPointPostalCode: delivery.pickupPointPostalCode } : {}),
                        ...(delivery?.pickupPointCity ? { pickupPointCity: delivery.pickupPointCity } : {}),
                        ...(delivery?.pickupPointCarrier ? { pickupPointCarrier: delivery.pickupPointCarrier } : {}),
                        items: group.items.map((item) => ({
                            variantLegacyId: item.variantId,
                            quantity: item.quantity,
                            priceAtPurchaseCents: Math.round(item.unitPrice * 100),
                            shippingCostAtPurchaseCents: Math.round(item.shippingCost * 100),
                        })),
                    };
                }),
            });

            for (const order of result.orders) {
                createdOrders.push({
                    id: order.id,
                    publicId: order.public_id,
                    shopId: order.shop_id ?? '',
                });
            }
        } catch (error) {
            console.error(JSON.stringify({
                event: 'checkout.convex_order_creation_failed',
                checkoutGroupId,
                error: error instanceof Error ? error.message : String(error),
            }));
            await stripe.checkout.sessions.expire(session.id).catch((expireError) => {
                console.error(JSON.stringify({
                    event: 'checkout.session_expire_failed',
                    sessionId: session?.id,
                    error: expireError instanceof Error ? expireError.message : String(expireError),
                }));
            });
            return jsonResponse({ error: t.apiOrderCreateError }, 500);
        }
    } else {
        for (const group of shopGroups.values()) {
            const shopPublicId = `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
            const shopTotal = group.subtotal + group.shipping;

            const isPickup = delivery?.type === DELIVERY_TYPE.PICKUP_POINT;

            const adminClient = createSupabaseAdminClient();
            const { data: orderData, error: orderError } = await adminClient.rpc('create_checkout_order', {
                p_buyer_id: user.id,
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
                    shipping_cost_at_purchase: item.shippingCost,
                })),
                p_delivery_type: delivery?.type || DELIVERY_TYPE.HOME,
                p_pickup_point_id: delivery?.pickupPointId || null,
                p_pickup_point_name: delivery?.pickupPointName || null,
                p_pickup_point_address: delivery?.pickupPointAddress || null,
                p_pickup_point_postal_code: delivery?.pickupPointPostalCode || null,
                p_pickup_point_city: delivery?.pickupPointCity || null,
                p_pickup_point_carrier: delivery?.pickupPointCarrier || null,
            });

            if (orderError) {
                console.error(JSON.stringify({
                    event: 'checkout.order_creation_failed',
                    shopId: group.shopId,
                    checkoutGroupId,
                    error: orderError.message,
                }));
                await stripe.checkout.sessions.expire(session.id).catch((expireError) => {
                    console.error(JSON.stringify({
                        event: 'checkout.session_expire_failed',
                        sessionId: session?.id,
                        error: expireError instanceof Error ? expireError.message : String(expireError),
                    }));
                });

                // Orders already created for other shops in this same checkout attempt
                // point at the now-expired session and can never be paid — cancel them
                // instead of leaving them stuck as "pending" forever.
                if (createdOrders.length > 0) {
                    const rollbackClient = createSupabaseAdminClient();
                    const { error: rollbackError } = await rollbackClient
                        .from('orders')
                        .update({ status: 'cancelled', cancellation_reason: 'checkout_failed' })
                        .in('id', createdOrders.map((created) => created.id));

                    if (rollbackError) {
                        console.error(JSON.stringify({
                            event: 'checkout.order_rollback_failed',
                            checkoutGroupId,
                            orderIds: createdOrders.map((created) => created.id),
                            error: rollbackError.message,
                        }));
                    }
                }

                return jsonResponse({ error: t.apiOrderCreateError }, 500);
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
    }

    return jsonResponse({
        checkoutUrl: session.url,
        orders: createdOrders,
        checkoutGroupId,
    }, 200);
};
