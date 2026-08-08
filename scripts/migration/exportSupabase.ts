import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Creates a local, repeatable Supabase snapshot for the Convex migration.
 *
 * The output is written below .migrations/, which is ignored by Git. It
 * contains user data and private Storage objects and must never be committed.
 *
 * Required environment variables (Bun loads .env automatically):
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *
 * Usage:
 *   bun run migration:export
 *   bun run migration:export -- --output .migrations/supabase-export/manual
 */

const TABLES = [
    ['profiles', 'id'],
    ['shops', 'id'],
    ['shop_payment_accounts', 'shop_id'],
    ['processed_webhook_events', 'event_id'],
    ['products', 'id'],
    ['product_variants', 'id'],
    ['orders', 'id'],
    ['order_items', 'id'],
    ['refunds', 'id'],
    ['order_incidents', 'id'],
    ['sendcloud_config', 'id'],
    ['shipments', 'id'],
    ['shipment_tracking', 'id'],
    ['reviews', 'id'],
    ['wishlist', 'id'],
    ['push_subscriptions', 'id'],
    ['notification_log', 'id'],
] as const;

const PAGE_SIZE = 1_000;
const root = process.cwd();
const outputArgumentIndex = process.argv.indexOf('--output');
const requestedOutput = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
}

const apiBase = supabaseUrl.replace(/\/$/, '');
const outputDir = path.resolve(
    root,
    requestedOutput ?? '.migrations/supabase-export/' + new Date().toISOString().replace(/[:.]/g, '-'),
);
const apiHeaders = {
    apikey: secretKey,
    Authorization: 'Bearer ' + secretKey,
};

type JsonRecord = Record<string, unknown>;

interface StorageFile {
    bucket: string;
    path: string;
    bytes: number;
    contentType: string | null;
    etag: string | null;
    sha256: string;
    localPath: string;
}

async function readJson(response: Response, label: string): Promise<unknown> {
    const body = await response.text();
    let payload: unknown;
    try {
        payload = body ? JSON.parse(body) : null;
    } catch {
        payload = body;
    }

    if (!response.ok) {
        const details = typeof payload === 'string' ? payload.slice(0, 240) : JSON.stringify(payload).slice(0, 240);
        throw new Error(label + ' failed (' + response.status + '): ' + details);
    }

    return payload;
}

async function fetchTable(table: string): Promise<JsonRecord[]> {
    const rows: JsonRecord[] = [];
    let offset = 0;

    while (true) {
        const url = new URL(apiBase + '/rest/v1/' + table);
        url.searchParams.set('select', '*');
        url.searchParams.set('limit', String(PAGE_SIZE));
        url.searchParams.set('offset', String(offset));

        const response = await fetch(url, {
            headers: {
                ...apiHeaders,
                Prefer: 'count=exact',
            },
        });
        const page = await readJson(response, 'table ' + table);
        if (!Array.isArray(page)) {
            throw new Error('table ' + table + ' returned a non-array response');
        }

        rows.push(...(page as JsonRecord[]));
        if (page.length < PAGE_SIZE) break;
        offset += page.length;
    }

    return rows;
}

async function fetchAuthUsers(): Promise<JsonRecord[]> {
    const users: JsonRecord[] = [];
    let page = 1;

    while (true) {
        const url = new URL(apiBase + '/auth/v1/admin/users');
        url.searchParams.set('per_page', String(PAGE_SIZE));
        url.searchParams.set('page', String(page));

        const response = await fetch(url, { headers: apiHeaders });
        const payload = await readJson(response, 'auth.users');
        const batch = (payload as { users?: unknown } | null)?.users;
        if (!Array.isArray(batch)) {
            throw new Error('auth.users returned no users array');
        }

        users.push(...(batch as JsonRecord[]));
        if (batch.length < PAGE_SIZE) break;
        page += 1;
    }

    return users;
}

async function listStorageFiles(bucket: string): Promise<Array<{ path: string; metadata: JsonRecord }>> {
    const files: Array<{ path: string; metadata: JsonRecord }> = [];
    const pendingPrefixes = [''];
    const visitedPrefixes = new Set<string>();

    while (pendingPrefixes.length > 0) {
        const prefix = pendingPrefixes.shift()!;
        if (visitedPrefixes.has(prefix)) continue;
        visitedPrefixes.add(prefix);

        const response = await fetch(apiBase + '/storage/v1/object/list/' + encodeURIComponent(bucket), {
            method: 'POST',
            headers: {
                ...apiHeaders,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prefix,
                limit: PAGE_SIZE,
                offset: 0,
                sortBy: { column: 'name', order: 'asc' },
            }),
        });
        const payload = await readJson(response, 'storage list ' + bucket + '/' + prefix);
        if (!Array.isArray(payload)) {
            throw new Error('storage list ' + bucket + '/' + prefix + ' returned a non-array response');
        }

        for (const entry of payload as JsonRecord[]) {
            const name = typeof entry.name === 'string' ? entry.name : '';
            if (!name || name.includes('..')) {
                throw new Error('unsafe Storage object name in ' + bucket + ': ' + name);
            }

            const objectPath = prefix ? prefix.replace(/\/$/, '') + '/' + name : name;
            const isDirectory = entry.id == null && entry.metadata == null;
            if (isDirectory) {
                pendingPrefixes.push(objectPath + '/');
            } else {
                files.push({ path: objectPath, metadata: entry });
            }
        }
    }

    return files;
}

function storageDownloadUrl(bucket: string, objectPath: string): string {
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    return apiBase + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + encodedPath;
}

async function downloadStorageFile(bucket: string, objectPath: string, destination: string): Promise<StorageFile> {
    const response = await fetch(storageDownloadUrl(bucket, objectPath), { headers: apiHeaders });
    const body = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
        throw new Error('storage download ' + bucket + '/' + objectPath + ' failed (' + response.status + ')');
    }

    const relativePath = path.join('storage', bucket, objectPath);
    const localPath = path.resolve(destination, relativePath);
    if (!localPath.startsWith(path.resolve(destination) + path.sep)) {
        throw new Error('unsafe local Storage path: ' + objectPath);
    }

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, body);

    return {
        bucket,
        path: objectPath,
        bytes: body.byteLength,
        contentType: null,
        etag: null,
        sha256: createHash('sha256').update(body).digest('hex'),
        localPath: relativePath,
    };
}

async function main(): Promise<void> {
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.join(outputDir, 'tables'), { recursive: true });

    const tableCounts: Record<string, number> = {};
    for (const [table] of TABLES) {
        const rows = await fetchTable(table);
        tableCounts[table] = rows.length;
        await writeFile(path.join(outputDir, 'tables', table + '.json'), JSON.stringify(rows, null, 2) + '\n');
        console.log('exported ' + table + ': ' + rows.length + ' rows');
    }

    const authUsers = await fetchAuthUsers();
    await writeFile(path.join(outputDir, 'auth.users.json'), JSON.stringify(authUsers, null, 2) + '\n');
    console.log('exported auth.users: ' + authUsers.length + ' rows');

    const bucketsResponse = await fetch(apiBase + '/storage/v1/bucket', { headers: apiHeaders });
    const buckets = await readJson(bucketsResponse, 'storage buckets');
    await writeFile(path.join(outputDir, 'storage.buckets.json'), JSON.stringify(buckets, null, 2) + '\n');

    const storageFiles: StorageFile[] = [];
    for (const bucket of ['imgs', 'labels']) {
        const objects = await listStorageFiles(bucket);
        console.log('found ' + bucket + ': ' + objects.length + ' objects');
        for (const object of objects) {
            const file = await downloadStorageFile(bucket, object.path, outputDir);
            file.contentType = typeof object.metadata.mimetype === 'string'
                ? object.metadata.mimetype
                : typeof object.metadata.contentType === 'string'
                    ? object.metadata.contentType
                    : null;
            file.etag = typeof object.metadata.etag === 'string' ? object.metadata.etag : null;
            storageFiles.push(file);
            console.log('downloaded ' + bucket + '/' + object.path + ': ' + file.bytes + ' bytes');
        }
    }

    const manifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        sourceHost: new URL(apiBase).host,
        tableCounts,
        authUsers: authUsers.length,
        storageFiles,
    };
    await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('snapshot complete: ' + path.relative(root, outputDir));
}

await main();
