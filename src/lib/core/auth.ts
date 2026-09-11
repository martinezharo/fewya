import type { AstroCookies } from 'astro';
import type { ConvexHttpClient } from 'convex/browser';
import { createConvexClient } from './convex';

/**
 * Identity of the Clerk-authenticated caller for the current request.
 *
 * `id` is the profile UUID (`profiles.legacyId` in Convex). It stayed the
 * canonical user id after the Supabase migration so that imported orders,
 * shops and reviews keep pointing at the same person.
 */
export interface AuthUser {
    id: string;
    /**
     * Null when the identity provider sent no email claim. It is never a
     * stand-in address: a caller that needs a real inbox must handle its
     * absence rather than be handed something undeliverable.
     */
    email: string | null;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
}

// The middleware verifies the Clerk session once per request and publishes the
// result here. A WeakMap keeps that request-scoped without putting identity
// data in a cookie, and without threading it through every component prop.
const requestUsers = new WeakMap<Request, AuthUser>();
const requestConvexTokens = new WeakMap<Request, string>();

export function setRequestAuthUser(request: Request, user: AuthUser, convexToken?: string) {
    requestUsers.set(request, user);
    if (convexToken) requestConvexTokens.set(request, convexToken);
}

/** The authenticated caller, or null for an anonymous request. */
export function getRequestUser(request: Request): AuthUser | null {
    return requestUsers.get(request) ?? null;
}

export function hasRequestAuthUser(request: Request) {
    return requestUsers.has(request);
}

export function getRequestConvexToken(request: Request) {
    return requestConvexTokens.get(request) ?? null;
}

/**
 * Convex client that acts as the caller, so every query and mutation is
 * authorized by the Clerk identity instead of by the calling route.
 *
 * Returns null when the request is anonymous or Convex is not configured;
 * callers answer that with 401/503 rather than falling back to a privileged
 * client.
 */
export function createRequestConvexClient(request: Request): ConvexHttpClient | null {
    const token = getRequestConvexToken(request);
    return token ? createConvexClient(token) : null;
}

export function normalizeAuthRedirectPath(path: string | null | undefined, fallback = '/') {
    // Reject anything that isn't a same-origin absolute path. Browsers normalize a
    // leading backslash to a forward slash, so `/\evil.com` would otherwise be
    // treated as safe here while resolving to a protocol-relative `//evil.com`
    // open redirect once placed in a Location header.
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')
        || /[\u0000-\u0020\u007f]/.test(path)) {
        return fallback;
    }

    return path;
}

export function isAuthPage(pathname: string) {
    return /^\/(login|sign-up)\/?$/.test(pathname);
}

/** One return destination for SSR, OAuth transfers, and both auth forms. */
export function getAuthRedirectPath(url: URL) {
    const requested = url.searchParams.get('redirect_to') || url.searchParams.get('redirect_url');
    if (!requested) return '/me';

    try {
        let path = requested;
        // Clerk's redirect_url may contain the full URL of the originating page.
        if (/^https?:\/\//.test(path)) {
            const target = new URL(path);
            if (target.origin !== url.origin) return '/me';
            path = target.pathname + target.search + target.hash;
        }
        path = normalizeAuthRedirectPath(path, '/me');
        const target = new URL(path, url.origin);
        // Normalize dot segments and encoded route names before checking for loops.
        if (isAuthPage(decodeURIComponent(target.pathname))) return '/me';
        return normalizeAuthRedirectPath(target.pathname + target.search + target.hash, '/me');
    } catch {
        return '/me';
    }
}

/**
 * Builds the sign-in URL for a protected page. Clerk renders the form at
 * /login and returns the visitor to `redirectTo` afterwards.
 */
export function loginRedirectPath(redirectTo: string, role?: string | null) {
    const params = new URLSearchParams({ redirect_to: normalizeAuthRedirectPath(redirectTo) });
    if (role) params.set('role', role);
    return `/login?${params.toString()}`;
}

/**
 * Returns false when the request Origin header is present and does not match
 * the request URL's origin (cross-origin POST). Returns true for same-origin
 * requests and for requests without an Origin header (non-browser callers).
 */
export function assertSameOrigin(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    const requestOrigin = new URL(request.url).origin;
    return origin === requestOrigin;
}

/**
 * Clears the cookies the Supabase OAuth flow used to leave behind. Clerk owns
 * the session now; this only stops stale cookies from lingering in browsers
 * that signed in before the migration.
 */
export function clearLegacyAuthCookies(cookies: AstroCookies, url: URL) {
    const secure = url.protocol === 'https:';
    for (const base of ['fewya-auth-redirect', 'fewya-auth-role']) {
        const name = secure ? `__Host-${base}` : base;
        cookies.set(name, '', { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 0 });
    }
}
