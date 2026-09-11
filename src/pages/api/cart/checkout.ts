import type { APIRoute } from 'astro';
import {
    buildStripeLineItems,
    CHECKOUT_CURRENCY,
    type CheckoutResolvedItem,
    normalizeCheckoutItems,
} from '../../../lib/cart/checkout';
import { createRequestConvexClient, getRequestUser } from '../../../lib/core/auth';
import { realEmail } from '../../../../convex/lib/placeholderEmail';
import { api } from '../../../../convex/_generated/api';
import { toProfileFields } from '../../../lib/core/profile';

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

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!user || !convex) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

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

    type CheckoutVariantRow = JoinedVariant & { id: string };

    let variantRows: CheckoutVariantRow[] = [];
    let variantsError: { message: string } | null = null;

    const profile = toProfileFields(await convex.query(api.users.current, {}));
    if (!profile) return jsonResponse({ error: t.apiUnauthorized }, 401);

    try {
        const rows = await convex.query(api.catalog.getCartVariants, {
            ids: normalizedItems.map((item) => item.variantId),
        });
        variantRows = rows.map((row) => ({
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
                    // Convex answers whether the shop can be paid; the account
                    // id itself is only used as a truthiness check here, and
                    // the real destination is resolved again at payout time.
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

    const firstName = profile.first_name?.trim() || user.fullName?.trim() || null;
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
    // Stamped onto the order, sent to Stripe as the receipt address and passed
    // to the carrier as the recipient, so a stand-in must not reach it.
    const buyerEmail = realEmail(user.email) ?? realEmail(profile.email);

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
            event: 'checkout.order_creation_failed',
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

    return jsonResponse({
        checkoutUrl: session.url,
        orders: createdOrders,
        checkoutGroupId,
    }, 200);
};
