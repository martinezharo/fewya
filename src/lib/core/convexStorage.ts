import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { createConvexClient } from './convex';
import { getRequestConvexToken } from './auth';
import { STORAGE_MARKER_PREFIX, isStorageMarker, storageIdFromMarker } from '../../../convex/lib/storageMarker';

export { STORAGE_MARKER_PREFIX, isStorageMarker, storageIdFromMarker };

function callerClient(request: Request) {
    const token = getRequestConvexToken(request);
    const client = token ? createConvexClient(token) : null;
    if (!client) throw new Error('Convex authentication is required for storage access');
    return client;
}

export async function uploadConvexFile(request: Request, file: File, contentType: string) {
    return uploadConvexBytes(request, new Uint8Array(await file.arrayBuffer()), contentType);
}

/**
 * Uploads bytes as the caller and returns the stored object's URL and marker.
 *
 * The upload URL returns the storage ID to us rather than to Convex, so the
 * claim is what records who owns the file. Nothing can read it back until that
 * has happened, which is also why the claim is not optional.
 */
export async function uploadConvexBytes(request: Request, bytes: Uint8Array, contentType: string) {
    const client = callerClient(request);
    const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: bytes as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`Convex upload failed (${response.status})`);
    const payload = await response.json() as { storageId?: string };
    if (!payload.storageId) throw new Error('Convex upload did not return a storage ID');

    const storageId = payload.storageId as Id<'_storage'>;
    const { url, path } = await client.mutation(api.storage.claimUpload, { storageId });
    return { url, path, storageId };
}

export async function deleteConvexFile(request: Request, path: string) {
    const storageId = storageIdFromMarker(path);
    if (!storageId) throw new Error('Invalid Convex storage path');
    await callerClient(request).mutation(api.storage.deleteSellerFile, {
        storageId: storageId as Id<'_storage'>,
    });
}
