import { convexTest } from 'convex-test';
import schema from '../../convex/schema';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * Convex functions are where authorization lives now that the database has no
 * row-level policies of its own. These fixtures build two independent tenants
 * — two buyers, two sellers, two shops — so a test can ask the only question
 * that matters: can the wrong person reach this document?
 */
export function newTestHarness() {
    return convexTest(schema, import.meta.glob('../../convex/**/*.ts'));
}

export type Harness = ReturnType<typeof newTestHarness>;

export function identity(subject: string, email: string) {
    return { subject, email, emailVerified: true } as Record<string, unknown>;
}

const now = 1_760_000_000_000;

export interface SeededTenant {
    profileId: Id<'profiles'>;
    profileLegacyId: string;
    shopId: Id<'shops'>;
    shopLegacyId: string;
    productId: Id<'products'>;
    productLegacyId: string;
    variantId: Id<'productVariants'>;
    variantLegacyId: string;
}

/** Seeds a seller with one shop holding one purchasable product. */
export async function seedTenant(t: Harness, key: string, subject: string): Promise<SeededTenant> {
    return await t.run(async (ctx) => {
        const profileId = await ctx.db.insert('profiles', {
            legacyId: `profile-${key}`,
            authSubject: subject,
            email: `${key}@fewya.test`,
            isSeller: true,
            emailMarketingOptIn: false,
            createdAt: now,
        });
        const shopId = await ctx.db.insert('shops', {
            legacyId: `shop-${key}`,
            ownerId: profileId,
            ownerLegacyId: `profile-${key}`,
            name: `Shop ${key}`,
            slug: `shop-${key}`,
            isActive: true,
            status: 'active',
            createdAt: now,
            paymentsActive: true,
            sellerDetailsComplete: true,
            allowLoss: false,
            shippingCarriers: ['correos'],
        });
        await ctx.db.insert('shopPaymentAccounts', {
            legacyId: `account-${key}`,
            shopId,
            shopLegacyId: `shop-${key}`,
            stripeAccountId: `acct_${key}`,
            chargesEnabled: true,
            payoutsEnabled: true,
            detailsSubmitted: true,
            createdAt: now,
            updatedAt: now,
        });
        const productId = await ctx.db.insert('products', {
            legacyId: `product-${key}`,
            shopId,
            shopLegacyId: `shop-${key}`,
            title: `Product ${key}`,
            category: 'tecnologia',
            galleryImages: ['https://cdn.test/a.webp'],
            isActive: true,
            createdAt: now,
            specifications: {},
            slug: `product-${key}`,
            description: 'A product',
        });
        const variantId = await ctx.db.insert('productVariants', {
            legacyId: `variant-${key}`,
            productId,
            productLegacyId: `product-${key}`,
            priceCents: 2000,
            stock: 5,
            createdAt: now,
            isDefault: true,
            weightKg: 1,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
            shippingCostCents: 300,
        });
        return {
            profileId,
            profileLegacyId: `profile-${key}`,
            shopId,
            shopLegacyId: `shop-${key}`,
            productId,
            productLegacyId: `product-${key}`,
            variantId,
            variantLegacyId: `variant-${key}`,
        };
    });
}

/** Seeds a buyer profile linked to the given Clerk subject. */
export async function seedBuyer(t: Harness, key: string, subject: string) {
    return await t.run(async (ctx) => {
        const profileId = await ctx.db.insert('profiles', {
            legacyId: `profile-${key}`,
            authSubject: subject,
            email: `${key}@fewya.test`,
            isSeller: false,
            emailMarketingOptIn: false,
            createdAt: now,
        });
        return { profileId, profileLegacyId: `profile-${key}` };
    });
}

/** Seeds a post-cutover order for `buyer` at `tenant`'s shop. */
export async function seedOrder(
    t: Harness,
    key: string,
    buyer: { profileId: Id<'profiles'>; profileLegacyId: string },
    tenant: SeededTenant,
    overrides: Record<string, unknown> = {},
) {
    return await t.run(async (ctx) => {
        const orderId = await ctx.db.insert('orders', {
            // Only orders created after the cutover carry the convex: prefix,
            // and only those may be mutated.
            legacyId: `convex:${key}`,
            publicId: key,
            buyerId: buyer.profileId,
            buyerLegacyId: buyer.profileLegacyId,
            shopId: tenant.shopId,
            shopLegacyId: tenant.shopLegacyId,
            status: 'delivered',
            paymentStatus: 'paid',
            totalAmountCents: 2300,
            currency: 'eur',
            hasInsurance: false,
            stripePaymentIntentId: `pi_${key}`,
            paidAt: now,
            deliveredAt: now,
            fundsReleaseStatus: 'pending',
            createdAt: now,
            ...overrides,
        });
        await ctx.db.insert('orderItems', {
            legacyId: `item-${key}`,
            orderId,
            orderLegacyId: `convex:${key}`,
            quantity: 1,
            priceAtPurchaseCents: 2000,
            shippingCostAtPurchaseCents: 300,
            variantId: tenant.variantId,
            variantLegacyId: tenant.variantLegacyId,
        });
        return { orderId, orderLegacyId: `convex:${key}` };
    });
}
