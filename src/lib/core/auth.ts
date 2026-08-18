import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from './supabase-admin';
import { convexOnly } from './env';

const AUTH_REDIRECT_BASE = 'fewya-auth-redirect';
const AUTH_ROLE_BASE = 'fewya-auth-role';

// Clerk authentication is established by the request middleware before any
// page or API handler creates its Supabase-compatible client. A WeakMap keeps
// that bridge request-scoped without putting identity data in a cookie.
const requestUsers = new WeakMap<Request, User>();
const requestConvexTokens = new WeakMap<Request, string>();

export function setRequestAuthUser(request: Request, user: User, convexToken?: string) {
    requestUsers.set(request, user);
    if (convexToken) requestConvexTokens.set(request, convexToken);
}

function getRequestAuthUser(request: Request) {
    return requestUsers.get(request);
}

export function hasRequestAuthUser(request: Request) {
    return requestUsers.has(request);
}

export function getRequestConvexToken(request: Request) {
    return requestConvexTokens.get(request) ?? null;
}

function createCompatibilityAuth(user: User | null) {
    const session: Session | null = user ? {
        access_token: '',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: '',
        user,
    } : null;

    return {
        getUser: async () => ({ data: { user }, error: null }),
        getSession: async () => ({ data: { session }, error: null }),
        // Clerk owns the browser session in Convex-only mode. Keeping this a
        // no-op makes legacy UI links harmless while the Clerk client signs out.
        signOut: async () => ({ error: null }),
    };
}

function createClerkCompatibilityClient(user: User): SupabaseClient {
    if (convexOnly) {
        const compatibilityAuth = createCompatibilityAuth(user);
        return new Proxy({ auth: compatibilityAuth } as unknown as SupabaseClient, {
            get(_target, property, _receiver) {
                if (property === 'auth') return compatibilityAuth;
                throw new Error(`Supabase compatibility is disabled in Convex-only mode (accessed ${String(property)})`);
            },
        });
    }

    const admin = createSupabaseAdminClient();
    const clerkAuthProxy = new Proxy(admin.auth, {
        get(target, property, receiver) {
            if (property === 'getUser') {
                return async () => ({ data: { user }, error: null });
            }
            if (property === 'getSession') {
                const session: Session = {
                    access_token: '',
                    token_type: 'bearer',
                    expires_in: 3600,
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    refresh_token: '',
                    user,
                };
                return async () => ({ data: { session }, error: null });
            }
            return Reflect.get(target, property, receiver);
        },
    });

    return new Proxy(admin, {
        get(target, property, receiver) {
            if (property === 'auth') return clerkAuthProxy;
            return Reflect.get(target, property, receiver);
        },
    });
}

/**
 * Returns the cookie name with __Host- prefix when on HTTPS.
 * __Host- prevents subdomain override and requires Path=/ and Secure.
 */
function authCookieName(base: string, url: URL): string {
    return url.protocol === 'https:' ? `__Host-${base}` : base;
}

/**
 * Creates a Supabase client with cookie-based session management for SSR.
 * Pass Astro.cookies and Astro.request from any page or API route.
 */
export function createSupabaseAuthClient(cookies: AstroCookies, request: Request) {
    const requestUser = getRequestAuthUser(request);
    if (requestUser) {
        return createClerkCompatibilityClient(requestUser);
    }

    if (convexOnly) {
        // Public pages still ask the compatibility client for auth state. Give
        // them an anonymous, read-only auth facade without opening Supabase.
        return new Proxy({ auth: createCompatibilityAuth(null) } as unknown as SupabaseClient, {
            get(_target, property, _receiver) {
                if (property === 'auth') return createCompatibilityAuth(null);
                throw new Error(`Supabase compatibility is disabled in Convex-only mode (accessed ${String(property)})`);
            },
        });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('SUPABASE_URL or SUPABASE_KEY environment variables are not configured');
    }
    return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
        cookies: {
            getAll() {
                const cookieHeader = request.headers.get('Cookie') ?? '';
                const cookies = parseCookieHeader(cookieHeader);
                return cookies.map(c => ({ name: c.name, value: c.value ?? '' }));
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) => {
                    cookies.set(name, value, options as Parameters<AstroCookies['set']>[2]);
                });
            },
        },
    });
}

function getAuthStateCookieOptions(url: URL): Parameters<AstroCookies['set']>[2] {
    return {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        maxAge: 60 * 10,
    };
}

function clearAuthStateCookie(cookies: AstroCookies, name: string, url: URL) {
    cookies.set(name, '', {
        ...getAuthStateCookieOptions(url),
        maxAge: 0,
    });
}

function hasPendingAuthState(cookies: AstroCookies, url: URL) {
    const redirectName = authCookieName(AUTH_REDIRECT_BASE, url);
    const roleName = authCookieName(AUTH_ROLE_BASE, url);
    return Boolean(cookies.get(redirectName)?.value || cookies.get(roleName)?.value);
}

function appendAuthError(path: string, url: URL) {
    const targetUrl = new URL(path, url.origin);
    targetUrl.searchParams.set('auth_error', '1');
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

export function normalizeAuthRedirectPath(path: string | null | undefined) {
    // Reject anything that isn't a same-origin absolute path. Browsers normalize a
    // leading backslash to a forward slash, so `/\evil.com` would otherwise be
    // treated as safe here while resolving to a protocol-relative `//evil.com`
    // open redirect once placed in a Location header.
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
        return '/';
    }

    return path;
}

export function storePendingAuthFlowState(
    cookies: AstroCookies,
    url: URL,
    redirectTo: string,
    role: string | null,
) {
    const options = getAuthStateCookieOptions(url);
    const redirectName = authCookieName(AUTH_REDIRECT_BASE, url);
    const roleName = authCookieName(AUTH_ROLE_BASE, url);

    cookies.set(redirectName, normalizeAuthRedirectPath(redirectTo), options);

    if (role) {
        cookies.set(roleName, role, options);
        return;
    }

    clearAuthStateCookie(cookies, roleName, url);
}

export function clearPendingAuthFlowState(cookies: AstroCookies, url: URL) {
    clearAuthStateCookie(cookies, authCookieName(AUTH_REDIRECT_BASE, url), url);
    clearAuthStateCookie(cookies, authCookieName(AUTH_ROLE_BASE, url), url);
}

function isNewlyRegisteredUser(user: User): boolean {
    if (!user.last_sign_in_at) {
        return false;
    }
    const createdAt = new Date(user.created_at).getTime();
    const lastSignInAt = new Date(user.last_sign_in_at).getTime();
    return Math.abs(lastSignInAt - createdAt) < 60_000;
}

export async function exchangeAuthCodeForSession(cookies: AstroCookies, request: Request, url: URL) {
    const code = url.searchParams.get('code');

    if (!code) {
        return null;
    }

    if (url.pathname !== '/api/auth/callback' && !hasPendingAuthState(cookies, url)) {
        return null;
    }

    const redirectCookieName = authCookieName(AUTH_REDIRECT_BASE, url);
    const roleCookieName = authCookieName(AUTH_ROLE_BASE, url);

    const redirectTo = normalizeAuthRedirectPath(
        url.searchParams.get('redirect_to') ?? cookies.get(redirectCookieName)?.value,
    );
    const role = url.searchParams.get('role') ?? cookies.get(roleCookieName)?.value ?? null;

    if (convexOnly) {
        // Clerk handles the OAuth/session exchange. Never send a callback code
        // to Supabase when the deployment is isolated on Convex.
        clearPendingAuthFlowState(cookies, url);
        return redirectTo;
    }

    const supabase = createSupabaseAuthClient(cookies, request);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    clearPendingAuthFlowState(cookies, url);

    if (error) {
        return appendAuthError(redirectTo, url);
    }

    if (role === 'seller' && data.session?.user) {
        await supabase
            .from('profiles')
            .update({ is_seller: true })
            .eq('id', data.session.user.id);
    }

    if (!role && data.session?.user && isNewlyRegisteredUser(data.session.user)) {
        return '/me/details?welcome=1';
    }

    return redirectTo;
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
