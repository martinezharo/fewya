/**
 * How a Convex Storage object is referenced from a document field.
 *
 * Storage IDs are stored inline in fields that also hold plain URLs — a
 * product image imported from Supabase, a Sendcloud label address — so the
 * prefix is what tells the two apart. It is shared by the Convex functions
 * and the Worker so both agree on the format.
 */
export const STORAGE_MARKER_PREFIX = 'convex-storage:';

export function storageMarker(storageId: string): string {
    return `${STORAGE_MARKER_PREFIX}${storageId}`;
}

export function isStorageMarker(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.startsWith(STORAGE_MARKER_PREFIX);
}

/** Returns the raw storage ID a marker points at, or null for anything else. */
export function storageIdFromMarker(value: string | null | undefined): string | null {
    return isStorageMarker(value) ? value.slice(STORAGE_MARKER_PREFIX.length) : null;
}
