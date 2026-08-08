import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const orderStatus = v.union(
    v.literal('pending'),
    v.literal('paid'),
    v.literal('processing'),
    v.literal('shipped'),
    v.literal('delivered'),
    v.literal('confirmed'),
    v.literal('incident'),
    v.literal('delivery_failed'),
    v.literal('cancelled'),
    v.literal('refunded'),
);

const paymentStatus = v.union(v.literal('pending'), v.literal('paid'));

const shipmentStatus = v.union(
    v.literal('pending'),
    v.literal('label_ready'),
    v.literal('shipped'),
    v.literal('delivered'),
    v.literal('failed'),
    v.literal('cancelled'),
);

const shopStatus = v.union(v.literal('active'), v.literal('inactive'));

/**
 * Convex document IDs are used for all new relationships. legacyId and the
 * temporary legacy relationship fields let the importer load a consistent
 * snapshot before it resolves every PostgreSQL UUID to a Convex document ID.
 */
export default defineSchema({
    profiles: defineTable({
        legacyId: v.string(),
        authSubject: v.optional(v.string()),
        email: v.string(),
        fullName: v.optional(v.string()),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
        address: v.optional(v.string()),
        addressStreet: v.optional(v.string()),
        addressNumber: v.optional(v.string()),
        addressFloor: v.optional(v.string()),
        addressPostalCode: v.optional(v.string()),
        addressCity: v.optional(v.string()),
        addressProvince: v.optional(v.string()),
        addressCountry: v.optional(v.string()),
        phone: v.optional(v.string()),
        phonePrefix: v.optional(v.string()),
        isSeller: v.boolean(),
        emailMarketingOptIn: v.boolean(),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_auth_subject', ['authSubject'])
        .index('by_email', ['email']),

    shops: defineTable({
        legacyId: v.string(),
        ownerId: v.optional(v.id('profiles')),
        ownerLegacyId: v.string(),
        name: v.string(),
        slug: v.string(),
        description: v.optional(v.string()),
        profileImg: v.optional(v.string()),
        bannerImg: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        whatsapp: v.optional(v.string()),
        isActive: v.boolean(),
        status: shopStatus,
        createdAt: v.number(),
        accentColor: v.optional(v.string()),
        location: v.optional(v.string()),
        defaultWeightKg: v.optional(v.number()),
        defaultLengthCm: v.optional(v.number()),
        defaultWidthCm: v.optional(v.number()),
        defaultHeightCm: v.optional(v.number()),
        defaultShippingCostCents: v.optional(v.number()),
        paymentsActive: v.boolean(),
        sellerDetailsComplete: v.boolean(),
        allowLoss: v.boolean(),
        shippingCarriers: v.array(v.string()),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_owner_id', ['ownerId'])
        .index('by_owner_legacy_id', ['ownerLegacyId'])
        .index('by_slug', ['slug'])
        .index('by_status', ['status']),

    shopPaymentAccounts: defineTable({
        legacyId: v.string(),
        shopId: v.optional(v.id('shops')),
        shopLegacyId: v.string(),
        stripeAccountId: v.string(),
        chargesEnabled: v.boolean(),
        payoutsEnabled: v.boolean(),
        detailsSubmitted: v.boolean(),
        onboardingCompletedAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_shop_id', ['shopId'])
        .index('by_stripe_account_id', ['stripeAccountId']),

    products: defineTable({
        legacyId: v.string(),
        shopId: v.optional(v.id('shops')),
        shopLegacyId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        category: v.string(),
        galleryImages: v.array(v.string()),
        isActive: v.boolean(),
        createdAt: v.number(),
        brand: v.optional(v.string()),
        specifications: v.any(),
        slug: v.string(),
        // Denormalised public text used by Convex full-text search. Keeping it
        // separate from the display fields lets us change ranking/search
        // normalisation without changing the public product shape.
        searchText: v.optional(v.string()),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_shop_id', ['shopId'])
        .index('by_shop_legacy_id', ['shopLegacyId'])
        .index('by_shop_slug', ['shopLegacyId', 'slug'])
        .index('by_active_created_at', ['isActive', 'createdAt'])
        .searchIndex('search_text', {
            searchField: 'searchText',
            filterFields: ['shopId', 'isActive'],
        }),

    productVariants: defineTable({
        legacyId: v.string(),
        productId: v.optional(v.id('products')),
        productLegacyId: v.string(),
        variantName: v.optional(v.string()),
        priceCents: v.number(),
        stock: v.number(),
        variantImage: v.optional(v.string()),
        createdAt: v.number(),
        isDefault: v.boolean(),
        weightKg: v.optional(v.number()),
        lengthCm: v.optional(v.number()),
        widthCm: v.optional(v.number()),
        heightCm: v.optional(v.number()),
        shippingCostCents: v.optional(v.number()),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_product_id', ['productId'])
        .index('by_product_legacy_id', ['productLegacyId'])
        .index('by_product_default', ['productId', 'isDefault']),

    orders: defineTable({
        legacyId: v.string(),
        publicId: v.string(),
        checkoutGroupId: v.optional(v.string()),
        buyerId: v.optional(v.id('profiles')),
        buyerLegacyId: v.optional(v.string()),
        shopId: v.optional(v.id('shops')),
        shopLegacyId: v.optional(v.string()),
        status: orderStatus,
        paymentStatus,
        totalAmountCents: v.number(),
        currency: v.string(),
        hasInsurance: v.boolean(),
        stripeCheckoutSessionId: v.optional(v.string()),
        stripePaymentIntentId: v.optional(v.string()),
        paidAt: v.optional(v.number()),
        shippedAt: v.optional(v.number()),
        deliveredAt: v.optional(v.number()),
        fundsReleasedAt: v.optional(v.number()),
        cancellationReason: v.optional(v.string()),
        buyerHiddenAt: v.optional(v.number()),
        fundsReleaseStatus: v.union(v.literal('pending'), v.literal('released'), v.literal('failed')),
        fundsReleaseLastError: v.optional(v.string()),
        buyerEmail: v.optional(v.string()),
        shippingFullName: v.optional(v.string()),
        shippingPhone: v.optional(v.string()),
        shippingAddress: v.optional(v.string()),
        deliveryType: v.optional(v.union(v.literal('home'), v.literal('pickup_point'))),
        pickupPointId: v.optional(v.string()),
        pickupPointName: v.optional(v.string()),
        pickupPointAddress: v.optional(v.string()),
        pickupPointPostalCode: v.optional(v.string()),
        pickupPointCity: v.optional(v.string()),
        pickupPointCarrier: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_public_id', ['publicId'])
        .index('by_buyer_id', ['buyerId'])
        .index('by_buyer_status', ['buyerId', 'status'])
        .index('by_shop_id', ['shopId'])
        .index('by_checkout_group_id', ['checkoutGroupId'])
        .index('by_stripe_session_id', ['stripeCheckoutSessionId'])
        .index('by_stripe_payment_intent_id', ['stripePaymentIntentId'])
        .index('by_status_delivered_at', ['status', 'deliveredAt']),

    orderItems: defineTable({
        legacyId: v.string(),
        orderId: v.optional(v.id('orders')),
        orderLegacyId: v.string(),
        quantity: v.number(),
        priceAtPurchaseCents: v.number(),
        shippingCostAtPurchaseCents: v.optional(v.number()),
        variantId: v.optional(v.id('productVariants')),
        variantLegacyId: v.optional(v.string()),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_order_id', ['orderId'])
        .index('by_order_legacy_id', ['orderLegacyId'])
        .index('by_variant_id', ['variantId']),

    refunds: defineTable({
        legacyId: v.string(),
        orderId: v.optional(v.id('orders')),
        orderLegacyId: v.string(),
        amountCents: v.number(),
        currency: v.string(),
        reason: v.optional(v.string()),
        stripeRefundId: v.optional(v.string()),
        processedBy: v.optional(v.id('profiles')),
        processedByLegacyId: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_order_id', ['orderId'])
        .index('by_order_legacy_id', ['orderLegacyId']),

    orderIncidents: defineTable({
        legacyId: v.string(),
        orderId: v.optional(v.id('orders')),
        orderLegacyId: v.string(),
        description: v.string(),
        photos: v.array(v.string()),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_order_id', ['orderId'])
        .index('by_order_legacy_id', ['orderLegacyId']),

    sendcloudConfig: defineTable({
        legacyId: v.string(),
        apiKey: v.optional(v.string()),
        senderName: v.optional(v.string()),
        senderCompany: v.optional(v.string()),
        senderAddress: v.optional(v.string()),
        senderCity: v.optional(v.string()),
        senderPostalCode: v.optional(v.string()),
        senderCountry: v.optional(v.string()),
        senderPhone: v.optional(v.string()),
        senderEmail: v.optional(v.string()),
        isActive: v.boolean(),
        updatedAt: v.number(),
    }).index('by_legacy_id', ['legacyId']),

    shipments: defineTable({
        legacyId: v.string(),
        orderId: v.optional(v.id('orders')),
        orderLegacyId: v.string(),
        sendcloudShipmentId: v.optional(v.string()),
        sendcloudReference: v.optional(v.string()),
        carrierId: v.optional(v.string()),
        carrierName: v.optional(v.string()),
        serviceName: v.optional(v.string()),
        status: shipmentStatus,
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        priceCents: v.optional(v.number()),
        currency: v.optional(v.string()),
        labelUrl: v.optional(v.string()),
        requestedAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_order_id', ['orderId'])
        .index('by_order_legacy_id', ['orderLegacyId'])
        .index('by_sendcloud_shipment_id', ['sendcloudShipmentId']),

    shipmentTracking: defineTable({
        legacyId: v.string(),
        shipmentId: v.optional(v.id('shipments')),
        shipmentLegacyId: v.string(),
        status: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        eventTimestamp: v.optional(v.number()),
        rawData: v.any(),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_shipment_id', ['shipmentId'])
        .index('by_shipment_legacy_id', ['shipmentLegacyId']),

    reviews: defineTable({
        legacyId: v.string(),
        productId: v.optional(v.id('products')),
        productLegacyId: v.string(),
        profileId: v.optional(v.id('profiles')),
        profileLegacyId: v.optional(v.string()),
        rating: v.number(),
        comment: v.optional(v.string()),
        sellerReply: v.optional(v.string()),
        sellerReplyAt: v.optional(v.number()),
        createdAt: v.number(),
        isAuto: v.boolean(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_product_id', ['productId'])
        .index('by_product_auto', ['productId', 'isAuto'])
        .index('by_profile_id', ['profileId']),

    wishlist: defineTable({
        legacyId: v.string(),
        profileId: v.optional(v.id('profiles')),
        profileLegacyId: v.string(),
        productId: v.optional(v.id('products')),
        productLegacyId: v.string(),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_profile_id', ['profileId'])
        .index('by_profile_product', ['profileId', 'productId'])
        .index('by_profile_legacy_product_legacy', ['profileLegacyId', 'productLegacyId'])
        .index('by_product_id', ['productId']),

    pushSubscriptions: defineTable({
        legacyId: v.string(),
        userId: v.optional(v.id('profiles')),
        userLegacyId: v.string(),
        endpoint: v.string(),
        p256dh: v.string(),
        auth: v.string(),
        userAgent: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_user_id', ['userId'])
        .index('by_endpoint', ['endpoint'])
        .index('by_user_legacy_id', ['userLegacyId']),

    notificationLog: defineTable({
        legacyId: v.string(),
        orderId: v.optional(v.id('orders')),
        orderLegacyId: v.optional(v.string()),
        recipientUserId: v.optional(v.id('profiles')),
        recipientUserLegacyId: v.optional(v.string()),
        type: v.string(),
        emailStatus: v.optional(v.string()),
        pushStatus: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_order_type', ['orderId', 'type'])
        .index('by_order_legacy_type', ['orderLegacyId', 'type']),

    processedWebhookEvents: defineTable({
        legacyId: v.string(),
        eventId: v.string(),
        source: v.string(),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_event_id', ['eventId'])
        .index('by_source', ['source']),

    storageObjects: defineTable({
        legacyId: v.string(),
        bucket: v.string(),
        legacyPath: v.string(),
        storageId: v.optional(v.id('_storage')),
        bytes: v.number(),
        contentType: v.optional(v.string()),
        etag: v.optional(v.string()),
        sha256: v.string(),
        visibility: v.union(v.literal('public'), v.literal('private')),
        createdAt: v.number(),
    })
        .index('by_legacy_id', ['legacyId'])
        .index('by_bucket_path', ['bucket', 'legacyPath'])
        .index('by_storage_id', ['storageId']),
});
