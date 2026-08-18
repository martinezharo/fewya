import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { createConvexClient } from './convex';
import { getRequestConvexToken } from './auth';

export async function uploadConvexFile(request: Request, file: File, contentType: string) {
    return uploadConvexBytes(request, new Uint8Array(await file.arrayBuffer()), contentType);
}

export async function uploadConvexBytes(request: Request, bytes: Uint8Array, contentType: string) {
    const token = getRequestConvexToken(request);
    const client = token ? createConvexClient(token) : null;
    if (!client) throw new Error('Convex authentication is required for uploads');
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
    const url = await client.query(api.storage.getUrl, { storageId });
    if (!url) throw new Error('Convex upload URL unavailable');
    return { url, path: `convex-storage:${payload.storageId}`, storageId };
}

export async function deleteConvexFile(request: Request, path: string) {
    if (!path.startsWith('convex-storage:')) throw new Error('Invalid Convex storage path');
    const token = getRequestConvexToken(request);
    const client = token ? createConvexClient(token) : null;
    if (!client) throw new Error('Convex authentication is required for storage deletion');
    await client.mutation(api.storage.deleteSellerFile, {
        storageId: path.slice('convex-storage:'.length) as Id<'_storage'>,
    });
}
