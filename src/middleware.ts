import { defineMiddleware } from 'astro:middleware';
import { exchangeAuthCodeForSession } from './lib/core/auth';

const PRIVATE_PREFIXES = ['/me', '/sell', '/cart', '/profile', '/wishlist', '/api'];
const PUBLIC_MAX_AGE = 60;
const PUBLIC_SWR = 300;

export const onRequest = defineMiddleware(async (context, next) => {
    if (context.request.method !== 'GET' || context.url.pathname === '/api/auth/callback') {
        return next();
    }

    const redirectTo = await exchangeAuthCodeForSession(context.cookies, context.request, context.url);
    if (redirectTo) {
        return context.redirect(redirectTo);
    }

    const response = await next();

    // Don't override Cache-Control already set by a handler
    if (response.headers.has('Cache-Control')) {
        return response;
    }

    const { pathname } = context.url;
    const isPrivate = PRIVATE_PREFIXES.some(p => pathname.startsWith(p));

    if (isPrivate) {
        response.headers.set('Cache-Control', 'private, no-store');
    } else {
        // For public pages, only cache anonymous requests — authenticated users get
        // personalised SSR content (wishlist, etc.) that must not be shared.
        const cookieHeader = context.request.headers.get('Cookie') ?? '';
        const hasSession = cookieHeader.includes('sb-') && cookieHeader.includes('auth-token');
        response.headers.set(
            'Cache-Control',
            hasSession
                ? 'private, no-store'
                : `public, s-maxage=${PUBLIC_MAX_AGE}, stale-while-revalidate=${PUBLIC_SWR}`,
        );
    }

    return response;
});
