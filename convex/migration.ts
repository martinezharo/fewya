import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const tableName = v.union(
    v.literal('profiles'),
    v.literal('shops'),
    v.literal('shopPaymentAccounts'),
    v.literal('products'),
    v.literal('productVariants'),
    v.literal('orders'),
    v.literal('orderItems'),
    v.literal('refunds'),
    v.literal('orderIncidents'),
    v.literal('sendcloudConfig'),
    v.literal('shipments'),
    v.literal('shipmentTracking'),
    v.literal('reviews'),
    v.literal('wishlist'),
    v.literal('pushSubscriptions'),
    v.literal('notificationLog'),
    v.literal('processedWebhookEvents'),
    v.literal('storageObjects'),
);

const migrationArgs = {
    secret: v.string(),
    table: tableName,
    documents: v.array(v.any()),
};

type QueryBuilder = {
    eq(field: string, value: unknown): unknown;
};

type MigrationDocument = {
    legacyId?: unknown;
    [key: string]: unknown;
};

type MigrationDb = {
    query(table: string): {
        withIndex(index: string, callback: (query: QueryBuilder) => unknown): {
            unique(): Promise<MigrationDocument | null>;
        };
        collect(): Promise<MigrationDocument[]>;
    };
    insert(table: string, document: MigrationDocument): Promise<string>;
    patch(id: string, document: MigrationDocument): Promise<void>;
};

function assertMigrationSecret(secret: string): void {
    const expected = process.env.MIGRATION_SECRET;
    const isLocalDeployment = process.env.CONVEX_CLOUD_URL?.startsWith('http://127.0.0.1:');
    if (isLocalDeployment && secret === 'local-migration-only') return;
    if (!expected || secret !== expected) {
        throw new Error('Migration endpoint is not authorized');
    }
}

/**
 * Temporary, idempotent loader used only for the offline Supabase snapshot.
 *
 * It is intentionally protected by a deployment environment secret. This
 * function must be removed (or made internal) before the first production
 * Convex deployment. Re-running a batch updates the document with the same
 * legacyId instead of duplicating it.
 */
export const importBatch = mutation({
    args: migrationArgs,
    handler: async (ctx, args) => {
        assertMigrationSecret(args.secret);

        const db = ctx.db as unknown as MigrationDb;
        const importedIds: string[] = [];
        let inserted = 0;
        let updated = 0;

        for (const rawDocument of args.documents) {
            const document = rawDocument as MigrationDocument;
            if (typeof document.legacyId !== 'string' || document.legacyId.length === 0) {
                throw new Error('Every migration document requires a non-empty legacyId');
            }

            const existing = await db
                .query(args.table)
                .withIndex('by_legacy_id', (query) => query.eq('legacyId', document.legacyId))
                .unique();

            if (existing) {
                await db.patch(String(existing._id), document);
                importedIds.push(String(existing._id));
                updated += 1;
            } else {
                const id = await db.insert(args.table, document);
                importedIds.push(String(id));
                inserted += 1;
            }
        }

        return {
            table: args.table,
            inserted,
            updated,
            ids: importedIds,
        };
    },
});

function indexByLegacyId(documents: MigrationDocument[]): Map<string, string> {
    return new Map(
        documents
            .filter((document) => typeof document.legacyId === 'string' && typeof document._id === 'string')
            .map((document) => [String(document.legacyId), String(document._id)]),
    );
}

async function collect(db: MigrationDb, table: string): Promise<MigrationDocument[]> {
    return db.query(table).collect();
}

async function patchRelationship(
    db: MigrationDb,
    document: MigrationDocument,
    field: string,
    legacyField: string,
    targets: Map<string, string>,
): Promise<boolean> {
    const legacyId = document[legacyField];
    if (typeof legacyId !== 'string') return false;
    const targetId = targets.get(legacyId);
    if (!targetId || document[field] === targetId) return false;
    await db.patch(String(document._id), { [field]: targetId });
    return true;
}

/** Resolves the temporary UUID relationships after all snapshot batches exist. */
export const resolveRelationships = mutation({
    args: { secret: v.string() },
    handler: async (ctx, args) => {
        assertMigrationSecret(args.secret);
        const db = ctx.db as unknown as MigrationDb;

        const profiles = indexByLegacyId(await collect(db, 'profiles'));
        const shops = indexByLegacyId(await collect(db, 'shops'));
        const products = indexByLegacyId(await collect(db, 'products'));
        const variants = indexByLegacyId(await collect(db, 'productVariants'));
        const orders = indexByLegacyId(await collect(db, 'orders'));
        const shipments = indexByLegacyId(await collect(db, 'shipments'));
        let resolved = 0;

        for (const document of await collect(db, 'shops')) {
            if (await patchRelationship(db, document, 'ownerId', 'ownerLegacyId', profiles)) resolved += 1;
        }
        for (const document of await collect(db, 'shopPaymentAccounts')) {
            if (await patchRelationship(db, document, 'shopId', 'shopLegacyId', shops)) resolved += 1;
        }
        for (const document of await collect(db, 'products')) {
            if (await patchRelationship(db, document, 'shopId', 'shopLegacyId', shops)) resolved += 1;
        }
        for (const document of await collect(db, 'productVariants')) {
            if (await patchRelationship(db, document, 'productId', 'productLegacyId', products)) resolved += 1;
        }
        for (const document of await collect(db, 'orders')) {
            if (await patchRelationship(db, document, 'buyerId', 'buyerLegacyId', profiles)) resolved += 1;
            if (await patchRelationship(db, document, 'shopId', 'shopLegacyId', shops)) resolved += 1;
        }
        for (const document of await collect(db, 'orderItems')) {
            if (await patchRelationship(db, document, 'orderId', 'orderLegacyId', orders)) resolved += 1;
            if (await patchRelationship(db, document, 'variantId', 'variantLegacyId', variants)) resolved += 1;
        }
        for (const document of await collect(db, 'refunds')) {
            if (await patchRelationship(db, document, 'orderId', 'orderLegacyId', orders)) resolved += 1;
            if (await patchRelationship(db, document, 'processedBy', 'processedByLegacyId', profiles)) resolved += 1;
        }
        for (const document of await collect(db, 'orderIncidents')) {
            if (await patchRelationship(db, document, 'orderId', 'orderLegacyId', orders)) resolved += 1;
        }
        for (const document of await collect(db, 'shipments')) {
            if (await patchRelationship(db, document, 'orderId', 'orderLegacyId', orders)) resolved += 1;
        }
        for (const document of await collect(db, 'shipmentTracking')) {
            if (await patchRelationship(db, document, 'shipmentId', 'shipmentLegacyId', shipments)) resolved += 1;
        }
        for (const document of await collect(db, 'reviews')) {
            if (await patchRelationship(db, document, 'productId', 'productLegacyId', products)) resolved += 1;
            if (await patchRelationship(db, document, 'profileId', 'profileLegacyId', profiles)) resolved += 1;
        }
        for (const document of await collect(db, 'wishlist')) {
            if (await patchRelationship(db, document, 'profileId', 'profileLegacyId', profiles)) resolved += 1;
            if (await patchRelationship(db, document, 'productId', 'productLegacyId', products)) resolved += 1;
        }
        for (const document of await collect(db, 'pushSubscriptions')) {
            if (await patchRelationship(db, document, 'userId', 'userLegacyId', profiles)) resolved += 1;
        }
        for (const document of await collect(db, 'notificationLog')) {
            if (await patchRelationship(db, document, 'orderId', 'orderLegacyId', orders)) resolved += 1;
            if (await patchRelationship(db, document, 'recipientUserId', 'recipientUserLegacyId', profiles)) resolved += 1;
        }

        return { resolved };
    },
});

export const generateStorageUploadUrl = mutation({
    args: { secret: v.string() },
    handler: async (ctx, args) => {
        assertMigrationSecret(args.secret);
        return await ctx.storage.generateUploadUrl();
    },
});

/**
 * Lets the snapshot importer remain idempotent for binary files as well as
 * database rows. A second run must not create orphaned Convex Storage files.
 */
export const getStorageObject = query({
    args: { secret: v.string(), legacyId: v.string() },
    handler: async (ctx, args) => {
        assertMigrationSecret(args.secret);
        const db = ctx.db as unknown as MigrationDb;
        const object = await db
            .query('storageObjects')
            .withIndex('by_legacy_id', (query) => query.eq('legacyId', args.legacyId))
            .unique();
        return object ? { storageId: object.storageId ? String(object.storageId) : null } : null;
    },
});

export const attachStorageObject = mutation({
    args: {
        secret: v.string(),
        legacyId: v.string(),
        storageId: v.id('_storage'),
    },
    handler: async (ctx, args) => {
        assertMigrationSecret(args.secret);
        const db = ctx.db as unknown as MigrationDb;
        const object = await db
            .query('storageObjects')
            .withIndex('by_legacy_id', (query) => query.eq('legacyId', args.legacyId))
            .unique();
        if (!object) throw new Error('Storage object not found: ' + args.legacyId);
        await db.patch(String(object._id), { storageId: args.storageId });
        return { id: String(object._id), storageId: String(args.storageId) };
    },
});
