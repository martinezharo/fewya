import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';
import { strings } from './i18n';

const AUTH_REDIRECT_COOKIE = 'fewya-auth-redirect';
const AUTH_ROLE_COOKIE = 'fewya-auth-role';

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

function hasPendingAuthState(cookies: AstroCookies) {
    return Boolean(cookies.get(AUTH_REDIRECT_COOKIE)?.value || cookies.get(AUTH_ROLE_COOKIE)?.value);
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
    cookies.set(AUTH_REDIRECT_COOKIE, normalizeAuthRedirectPath(redirectTo), options);

    if (role) {
        cookies.set(AUTH_ROLE_COOKIE, role, options);
        return;
    }

    clearAuthStateCookie(cookies, AUTH_ROLE_COOKIE, url);
}

export function clearPendingAuthFlowState(cookies: AstroCookies, url: URL) {
    clearAuthStateCookie(cookies, AUTH_REDIRECT_COOKIE, url);
    clearAuthStateCookie(cookies, AUTH_ROLE_COOKIE, url);
}

export async function exchangeAuthCodeForSession(cookies: AstroCookies, request: Request, url: URL) {
    const code = url.searchParams.get('code');

    if (!code) {
        return null;
    }

    if (url.pathname !== '/api/auth/callback' && !hasPendingAuthState(cookies)) {
        return null;
    }

    const redirectTo = normalizeAuthRedirectPath(
        url.searchParams.get('redirect_to') ?? cookies.get(AUTH_REDIRECT_COOKIE)?.value,
    );
    const role = url.searchParams.get('role') ?? cookies.get(AUTH_ROLE_COOKIE)?.value ?? null;
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

    return redirectTo;
}
