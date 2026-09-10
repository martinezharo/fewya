import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { storageIdFromMarker } from './storageMarker';

/**
 * Splits a Supabase Storage URL into the bucket and path the importer keyed
 * its `storageObjects` rows by. Imported documents still hold these URLs.
 */
function legacyStoragePath(value: string): { bucket: string; path: string } | null {
    try {
        const parsed = new URL(value);
        const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
        if (!match) return null;
        return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
    } catch {
        return null;
    }
}

/**
 * Turns a stored image or document reference into something a browser can
 * fetch: a Convex Storage marker, an imported reference mapped to the object
 * the migration uploaded, or any other URL passed through untouched.
 *
 * Imported references come in two shapes, because Supabase was used two ways.
 * Product and shop images were stored as the public object URL. Shipping
 * labels, which were never public, were stored as `bucket:path` — the same
 * string the importer used for the object's `legacyId`. Both resolve here;
 * only one of them used to.
 *
 * It answers for whatever it is given and authorizes nothing, so callers that
 * handle private documents must establish access first.
 */
export async function resolveStorageUrl(
    ctx: QueryCtx | MutationCtx,
    value: string | null | undefined,
): Promise<string | null> {
    if (!value) return null;

    const storageId = storageIdFromMarker(value);
    if (storageId) return await ctx.storage.getUrl(storageId as Id<'_storage'>) ?? value;

    const object = await importedObject(ctx, value);
    if (!object?.storageId) return value;
    return await ctx.storage.getUrl(object.storageId) ?? value;
}

/** Finds the imported object a pre-migration reference points at, if any. */
async function importedObject(ctx: QueryCtx | MutationCtx, value: string) {
    const legacy = legacyStoragePath(value);
    if (legacy) {
        return await ctx.db
            .query('storageObjects')
            .withIndex('by_bucket_path', (q) => q.eq('bucket', legacy.bucket).eq('legacyPath', legacy.path))
            .unique();
    }

    // `bucket:path`, as the importer keyed the object. Anything else — an
    // absolute URL to somewhere else, a provider's own document link — simply
    // matches no row and is handed back untouched.
    return await ctx.db
        .query('storageObjects')
        .withIndex('by_legacy_id', (q) => q.eq('legacyId', value))
        .unique();
}
