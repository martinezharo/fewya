import { ConvexHttpClient } from 'convex/browser';
import { CONVEX_URL } from 'astro:env/server';

/**
 * Creates a request-scoped Convex client for Astro server code.
 *
 * The URL is optional while the migration is in dual-read mode: callers can
 * fall back to Supabase until the Convex staging deployment is configured.
 */
export function createConvexClient(token?: string | null): ConvexHttpClient | null {
    if (!CONVEX_URL) return null;
    const client = new ConvexHttpClient(CONVEX_URL);
    setConvexAuth(client, token);
    return client;
}

/** Attach a Clerk/JWT token once authentication is migrated. */
export function setConvexAuth(client: ConvexHttpClient, token: string | null | undefined): void {
    if (token) client.setAuth(token);
}
