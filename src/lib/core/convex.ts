import { ConvexHttpClient } from 'convex/browser';
import { CONVEX_URL } from 'astro:env/server';

/**
 * Creates a request-scoped Convex client for Astro server code.
 *
 * Returns null when the deployment URL is not configured, which is the only
 * state in which the app has no data source at all — callers answer that with
 * a 503 rather than pretending the catalog is empty.
 */
export function createConvexClient(token?: string | null): ConvexHttpClient | null {
    if (!CONVEX_URL) return null;
    const client = new ConvexHttpClient(CONVEX_URL);
    setConvexAuth(client, token);
    return client;
}

/** Attach the caller's Clerk JWT so Convex authorizes as them. */
export function setConvexAuth(client: ConvexHttpClient, token: string | null | undefined): void {
    if (token) client.setAuth(token);
}
