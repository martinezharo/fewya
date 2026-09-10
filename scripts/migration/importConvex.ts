import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

type JsonRecord = Record<string, unknown>;
type ImportTable =
    | 'profiles'
    | 'shops'
    | 'shopPaymentAccounts'
    | 'products'
    | 'productVariants'
    | 'orders'
    | 'orderItems'
    | 'refunds'
    | 'orderIncidents'
    | 'sendcloudConfig'
    | 'shipments'
    | 'shipmentTracking'
    | 'reviews'
    | 'wishlist'
    | 'pushSubscriptions'
    | 'notificationLog'
    | 'processedWebhookEvents'
    | 'storageObjects';

const root = process.cwd();
const inputArgumentIndex = process.argv.indexOf('--input');
const requestedInput = inputArgumentIndex >= 0 ? process.argv[inputArgumentIndex + 1] : undefined;
const batchSize = 25;
const convexUrl = process.env.CONVEX_URL;
const migrationSecret = process.env.MIGRATION_SECRET ?? 'local-migration-only';

if (!convexUrl) {
    throw new Error('CONVEX_URL is required; run bunx convex dev --once first');
}
const configuredConvexUrl: string = convexUrl;

function asRecord(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | undefined {
    return value == null ? undefined : String(value);
}

function requiredString(value: unknown, fallback: string): string {
    return stringValue(value) ?? fallback;
}

function numberValue(value: unknown): number | undefined {
    if (value == null || value === '') return undefined;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function moneyCents(value: unknown): number | undefined {
    const amount = numberValue(value);
    return amount == null ? undefined : Math.round(amount * 100);
}

function booleanValue(value: unknown, fallback = false): boolean {
    return value == null ? fallback : Boolean(value);
}

function dateMilliseconds(value: unknown): number | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value === 'number') return value < 10_000_000_000 ? value * 1_000 : value;
    const milliseconds = Date.parse(String(value));
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function requiredDate(value: unknown): number {
    return dateMilliseconds(value) ?? 0;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function searchText(...values: unknown[]): string {
    return values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function optionalEnum(value: unknown, allowed: readonly string[]): string | undefined {
    const candidate = stringValue(value);
    return candidate && allowed.includes(candidate) ? candidate : undefined;
}

function document(fields: JsonRecord): JsonRecord {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function legacyId(row: JsonRecord, field = 'id'): string {
    const value = row[field];
    if (value == null) throw new Error('Migration row is missing ' + field);
    return String(value);
}

function transform(table: Exclude<ImportTable, 'storageObjects'>, row: JsonRecord): JsonRecord {
    switch (table) {
        case 'profiles':
            return document({
                legacyId: legacyId(row),
                email: requiredString(row.email, 'unknown+' + legacyId(row) + '@invalid.local'),
                fullName: stringValue(row.full_name),
                firstName: stringValue(row.first_name),
                lastName: stringValue(row.last_name),
                avatarUrl: stringValue(row.avatar_url),
                address: stringValue(row.address),
                addressStreet: stringValue(row.address_street),
                addressNumber: stringValue(row.address_number),
                addressFloor: stringValue(row.address_floor),
                addressPostalCode: stringValue(row.address_postal_code),
                addressCity: stringValue(row.address_city),
                addressProvince: stringValue(row.address_province),
                addressCountry: stringValue(row.address_country),
                phone: stringValue(row.phone),
                phonePrefix: stringValue(row.phone_prefix),
                isSeller: booleanValue(row.is_seller),
                emailMarketingOptIn: booleanValue(row.email_marketing_opt_in),
                createdAt: requiredDate(row.created_at),
            });
        case 'shops':
            return document({
                legacyId: legacyId(row),
                ownerLegacyId: requiredString(row.owner_id, ''),
                name: requiredString(row.name, 'Unnamed shop'),
                slug: requiredString(row.slug, legacyId(row)),
                description: stringValue(row.description),
                profileImg: stringValue(row.profile_img),
                bannerImg: stringValue(row.banner_img),
                contactEmail: stringValue(row.contact_email),
                whatsapp: stringValue(row.whatsapp),
                isActive: booleanValue(row.is_active, true),
                status: optionalEnum(row.status, ['active', 'inactive']) ?? 'active',
                createdAt: requiredDate(row.created_at),
                accentColor: stringValue(row.accent_color),
                location: stringValue(row.location),
                defaultWeightKg: numberValue(row.default_weight_kg),
                defaultLengthCm: numberValue(row.default_length_cm),
                defaultWidthCm: numberValue(row.default_width_cm),
                defaultHeightCm: numberValue(row.default_height_cm),
                defaultShippingCostCents: moneyCents(row.default_shipping_cost),
                paymentsActive: booleanValue(row.payments_active),
                sellerDetailsComplete: booleanValue(row.seller_details_complete),
                allowLoss: booleanValue(row.allow_loss),
                shippingCarriers: stringArray(row.shipping_carriers),
            });
        case 'shopPaymentAccounts':
            return document({
                legacyId: requiredString(row.shop_id, 'unknown'),
                shopLegacyId: requiredString(row.shop_id, ''),
                stripeAccountId: requiredString(row.stripe_account_id, ''),
                chargesEnabled: booleanValue(row.charges_enabled),
                payoutsEnabled: booleanValue(row.payouts_enabled),
                detailsSubmitted: booleanValue(row.details_submitted),
                onboardingCompletedAt: dateMilliseconds(row.onboarding_completed_at),
                createdAt: requiredDate(row.created_at),
                updatedAt: requiredDate(row.updated_at),
            });
        case 'products':
            return document({
                legacyId: legacyId(row),
                shopLegacyId: requiredString(row.shop_id, ''),
                title: requiredString(row.title, 'Untitled product'),
                description: stringValue(row.description),
                category: requiredString(row.category, 'uncategorized'),
                galleryImages: stringArray(row.gallery_images),
                isActive: booleanValue(row.is_active, true),
                createdAt: requiredDate(row.created_at),
                brand: stringValue(row.brand),
                specifications: row.specifications ?? {},
                slug: requiredString(row.slug, legacyId(row)),
                searchText: searchText(row.title, row.description, row.brand, row.category),
            });
        case 'productVariants':
            return document({
                legacyId: legacyId(row),
                productLegacyId: requiredString(row.product_id, ''),
                variantName: stringValue(row.variant_name),
                priceCents: moneyCents(row.price) ?? 0,
                stock: numberValue(row.stock) ?? 0,
                variantImage: stringValue(row.variant_image),
                createdAt: requiredDate(row.created_at),
                isDefault: booleanValue(row.is_default),
                weightKg: numberValue(row.weight_kg),
                lengthCm: numberValue(row.length_cm),
                widthCm: numberValue(row.width_cm),
                heightCm: numberValue(row.height_cm),
                shippingCostCents: moneyCents(row.shipping_cost),
            });
        case 'orders':
            return document({
                legacyId: legacyId(row),
                publicId: requiredString(row.public_id, legacyId(row)),
                checkoutGroupId: stringValue(row.checkout_group_id),
                buyerLegacyId: stringValue(row.buyer_id),
                shopLegacyId: stringValue(row.shop_id),
                status: optionalEnum(row.status, ['pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'delivery_failed', 'cancelled', 'refunded']) ?? 'pending',
                paymentStatus: optionalEnum(row.payment_status, ['pending', 'paid']) ?? 'pending',
                totalAmountCents: moneyCents(row.total_amount) ?? 0,
                currency: requiredString(row.currency, 'eur'),
                hasInsurance: booleanValue(row.has_insurance),
                stripeCheckoutSessionId: stringValue(row.stripe_checkout_session_id),
                stripePaymentIntentId: stringValue(row.stripe_payment_intent_id),
                paidAt: dateMilliseconds(row.paid_at),
                shippedAt: dateMilliseconds(row.shipped_at),
                deliveredAt: dateMilliseconds(row.delivered_at),
                fundsReleasedAt: dateMilliseconds(row.funds_released_at),
                cancellationReason: stringValue(row.cancellation_reason),
                buyerHiddenAt: dateMilliseconds(row.buyer_hidden_at),
                fundsReleaseStatus: optionalEnum(row.funds_release_status, ['pending', 'released', 'failed']) ?? 'pending',
                fundsReleaseLastError: stringValue(row.funds_release_last_error),
                buyerEmail: stringValue(row.buyer_email),
                shippingFullName: stringValue(row.shipping_full_name),
                shippingPhone: stringValue(row.shipping_phone),
                shippingAddress: stringValue(row.shipping_address),
                deliveryType: optionalEnum(row.delivery_type, ['home', 'pickup_point']),
                pickupPointId: stringValue(row.pickup_point_id),
                pickupPointName: stringValue(row.pickup_point_name),
                pickupPointAddress: stringValue(row.pickup_point_address),
                pickupPointPostalCode: stringValue(row.pickup_point_postal_code),
                pickupPointCity: stringValue(row.pickup_point_city),
                pickupPointCarrier: stringValue(row.pickup_point_carrier),
                createdAt: requiredDate(row.created_at),
            });
        case 'orderItems':
            return document({
                legacyId: legacyId(row),
                orderLegacyId: requiredString(row.order_id, ''),
                quantity: numberValue(row.quantity) ?? 0,
                priceAtPurchaseCents: moneyCents(row.price_at_purchase) ?? 0,
                shippingCostAtPurchaseCents: moneyCents(row.shipping_cost_at_purchase),
                variantLegacyId: stringValue(row.variant_id),
            });
        case 'refunds':
            return document({
                legacyId: legacyId(row),
                orderLegacyId: requiredString(row.order_id, ''),
                amountCents: moneyCents(row.amount) ?? 0,
                currency: requiredString(row.currency, 'eur'),
                reason: stringValue(row.reason),
                stripeRefundId: stringValue(row.stripe_refund_id),
                processedByLegacyId: stringValue(row.processed_by),
                createdAt: requiredDate(row.created_at),
            });
        case 'orderIncidents':
            return document({
                legacyId: legacyId(row),
                orderLegacyId: requiredString(row.order_id, ''),
                description: requiredString(row.description, ''),
                photos: stringArray(row.photos),
                createdAt: requiredDate(row.created_at),
            });
        case 'sendcloudConfig':
            return document({
                legacyId: requiredString(row.id, 'default'),
                apiKey: stringValue(row.api_key),
                senderName: stringValue(row.sender_name),
                senderCompany: stringValue(row.sender_company),
                senderAddress: stringValue(row.sender_address),
                senderCity: stringValue(row.sender_city),
                senderPostalCode: stringValue(row.sender_postal_code),
                senderCountry: stringValue(row.sender_country),
                senderPhone: stringValue(row.sender_phone),
                senderEmail: stringValue(row.sender_email),
                isActive: booleanValue(row.is_active),
                updatedAt: requiredDate(row.updated_at),
            });
        case 'shipments':
            return document({
                legacyId: legacyId(row),
                orderLegacyId: requiredString(row.order_id, ''),
                sendcloudShipmentId: stringValue(row.sendcloud_shipment_id),
                sendcloudReference: stringValue(row.sendcloud_reference),
                carrierId: stringValue(row.carrier_id),
                carrierName: stringValue(row.carrier_name),
                serviceName: stringValue(row.service_name),
                status: optionalEnum(row.status, ['pending', 'label_ready', 'shipped', 'delivered', 'failed', 'cancelled']) ?? 'pending',
                trackingNumber: stringValue(row.tracking_number),
                trackingUrl: stringValue(row.tracking_url),
                priceCents: moneyCents(row.price),
                currency: stringValue(row.currency),
                labelUrl: stringValue(row.label_url),
                requestedAt: dateMilliseconds(row.requested_at),
                createdAt: requiredDate(row.created_at),
                updatedAt: requiredDate(row.updated_at),
            });
        case 'shipmentTracking':
            return document({
                legacyId: legacyId(row),
                shipmentLegacyId: requiredString(row.shipment_id, ''),
                status: requiredString(row.status, ''),
                description: stringValue(row.description),
                location: stringValue(row.location),
                eventTimestamp: dateMilliseconds(row.event_timestamp),
                rawData: row.raw_data ?? null,
                createdAt: requiredDate(row.created_at),
            });
        case 'reviews':
            return document({
                legacyId: legacyId(row),
                productLegacyId: requiredString(row.product_id, ''),
                profileLegacyId: stringValue(row.profile_id),
                rating: numberValue(row.rating) ?? 1,
                comment: stringValue(row.comment),
                sellerReply: stringValue(row.seller_reply),
                sellerReplyAt: dateMilliseconds(row.seller_reply_at),
                createdAt: requiredDate(row.created_at),
                isAuto: booleanValue(row.is_auto),
            });
        case 'wishlist':
            return document({
                legacyId: legacyId(row),
                profileLegacyId: requiredString(row.profile_id, ''),
                productLegacyId: requiredString(row.product_id, ''),
                createdAt: requiredDate(row.created_at),
            });
        case 'pushSubscriptions':
            return document({
                legacyId: legacyId(row),
                userLegacyId: requiredString(row.user_id, ''),
                endpoint: requiredString(row.endpoint, ''),
                p256dh: requiredString(row.p256dh, ''),
                auth: requiredString(row.auth, ''),
                userAgent: stringValue(row.user_agent),
                createdAt: requiredDate(row.created_at),
            });
        case 'notificationLog':
            return document({
                legacyId: legacyId(row),
                orderLegacyId: stringValue(row.order_id),
                recipientUserLegacyId: stringValue(row.recipient_user_id),
                type: requiredString(row.type, ''),
                emailStatus: stringValue(row.email_status),
                pushStatus: stringValue(row.push_status),
                createdAt: requiredDate(row.created_at),
            });
        case 'processedWebhookEvents':
            return document({
                legacyId: requiredString(row.event_id, ''),
                eventId: requiredString(row.event_id, ''),
                source: requiredString(row.source, ''),
                createdAt: requiredDate(row.created_at),
            });
    }
}

async function readJson<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function latestSnapshot(): Promise<string> {
    if (requestedInput) return path.resolve(root, requestedInput);
    const base = path.join(root, '.migrations', 'supabase-export');
    const entries = await readdir(base, { withFileTypes: true });
    const snapshots = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const latest = snapshots.at(-1);
    if (!latest) throw new Error('No Supabase snapshot found; run bun run migration:export first');
    return path.join(base, latest);
}

async function importDocuments(
    client: ConvexHttpClient,
    table: ImportTable,
    documents: JsonRecord[],
): Promise<void> {
    for (let offset = 0; offset < documents.length; offset += batchSize) {
        const batch = documents.slice(offset, offset + batchSize);
        const result = await client.mutation(api.migration.importBatch, {
            secret: migrationSecret,
            table,
            documents: batch,
        });
        console.log(table + ': ' + (offset + batch.length) + '/' + documents.length + ' (' + result.inserted + ' inserted, ' + result.updated + ' updated)');
    }
}

async function main(): Promise<void> {
    const inputDir = await latestSnapshot();
    const client = new ConvexHttpClient(configuredConvexUrl);
    const order: Array<[Exclude<ImportTable, 'storageObjects'>, string]> = [
        ['profiles', 'profiles'],
        ['shops', 'shops'],
        ['shopPaymentAccounts', 'shop_payment_accounts'],
        ['products', 'products'],
        ['productVariants', 'product_variants'],
        ['orders', 'orders'],
        ['orderItems', 'order_items'],
        ['refunds', 'refunds'],
        ['orderIncidents', 'order_incidents'],
        ['sendcloudConfig', 'sendcloud_config'],
        ['shipments', 'shipments'],
        ['shipmentTracking', 'shipment_tracking'],
        ['reviews', 'reviews'],
        ['wishlist', 'wishlist'],
        ['pushSubscriptions', 'push_subscriptions'],
        ['notificationLog', 'notification_log'],
        ['processedWebhookEvents', 'processed_webhook_events'],
    ];

    for (const [convexTable, sourceTable] of order) {
        const rows = await readJson<JsonRecord[]>(path.join(inputDir, 'tables', sourceTable + '.json'));
        await importDocuments(client, convexTable, rows.map((row) => transform(convexTable, asRecord(row))));
    }

    const manifest = await readJson<{ generatedAt: string; storageFiles: Array<{ bucket: string; path: string; bytes: number; contentType?: string | null; etag?: string | null; sha256: string }> }>(path.join(inputDir, 'manifest.json'));
    const storageDocuments = manifest.storageFiles.map((file) => document({
        legacyId: file.bucket + ':' + file.path,
        bucket: file.bucket,
        legacyPath: file.path,
        bytes: file.bytes,
        contentType: file.contentType ?? undefined,
        etag: file.etag ?? undefined,
        sha256: file.sha256,
        visibility: file.bucket === 'labels' ? 'private' : 'public',
        createdAt: requiredDate(manifest.generatedAt),
    }));
    await importDocuments(client, 'storageObjects', storageDocuments);

    for (const file of manifest.storageFiles) {
        const localPath = path.join(inputDir, 'storage', file.bucket, file.path);
        const legacyStorageId = file.bucket + ':' + file.path;
        const existingStorage = await client.query(api.migration.getStorageObject, {
            secret: migrationSecret,
            legacyId: legacyStorageId,
        });
        if (existingStorage?.storageId) {
            console.log('skipped existing Convex Storage: ' + file.bucket + '/' + file.path);
            continue;
        }
        const bytes = await readFile(localPath);
        const uploadUrl = await client.mutation(api.migration.generateStorageUploadUrl, { secret: migrationSecret });
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': file.contentType ?? 'application/octet-stream',
            },
            body: bytes,
        });
        const uploadPayload = await uploadResponse.json().catch(() => null) as { storageId?: string } | null;
        if (!uploadResponse.ok || !uploadPayload?.storageId) {
            throw new Error('Convex Storage upload failed for ' + file.bucket + '/' + file.path);
        }
        await client.mutation(api.migration.attachStorageObject, {
            secret: migrationSecret,
            legacyId: legacyStorageId,
            storageId: uploadPayload.storageId as Id<'_storage'>,
        });
        console.log('uploaded Convex Storage: ' + file.bucket + '/' + file.path + ' (' + bytes.byteLength + ' bytes)');
    }

    const resolved = await client.mutation(api.migration.resolveRelationships, { secret: migrationSecret });
    console.log('relationships resolved: ' + resolved.resolved);
    console.log('Convex snapshot import complete from ' + path.relative(root, inputDir));
}

await main();
