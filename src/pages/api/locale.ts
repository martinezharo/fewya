import type { APIRoute } from 'astro';
import { LOCALE_COOKIE, isLocale } from '../../lib/core/i18n';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const POST: APIRoute = async ({ request, cookies, url }) => {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
    }

    const locale = (body as { locale?: unknown } | null)?.locale;
    if (typeof locale !== 'string' || !isLocale(locale)) {
        return new Response(JSON.stringify({ error: 'unsupported_locale' }), { status: 400 });
    }

    cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        maxAge: COOKIE_MAX_AGE,
    });

    return new Response(JSON.stringify({ ok: true, locale }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
    cookies.set(LOCALE_COOKIE, '', {
        path: '/',
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        maxAge: 0,
    });

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
