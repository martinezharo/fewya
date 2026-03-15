import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';

/**
 * Creates a Supabase client with cookie-based session management for SSR.
 * Pass Astro.cookies and Astro.request from any page or API route.
 */
export function createSupabaseAuthClient(cookies: AstroCookies, request: Request) {
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
