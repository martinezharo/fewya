import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';
import type { User } from '@supabase/supabase-js';
import { strings } from './i18n';

const AUTH_REDIRECT_BASE = 'fewya-auth-redirect';
const AUTH_ROLE_BASE = 'fewya-auth-role';

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
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error(strings.authMissingSupabaseEnv);
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
    if (!path || !path.startsWith('/') || path.startsWith('//')) {
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
        return '/me/details';
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
