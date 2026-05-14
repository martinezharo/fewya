import { defineMiddleware } from 'astro:middleware';
import { parseCookieHeader } from '@supabase/ssr';
import { exchangeAuthCodeForSession } from './lib/core/auth';
import { securityLog } from './lib/core/security-log';
import { checkRateLimit, rateLimitResponse, type RateLimitBinding } from './lib/core/rate-limit';

const PRIVATE_PREFIXES = ['/me', '/sell', '/cart', '/profile', '/wishlist', '/api'];
const PUBLIC_MAX_AGE = 60;
const PUBLIC_SWR = 300;

// Webhook routes that must not have CSRF or auth checks
const WEBHOOK_PATHS = new Set(['/api/webhooks/stripe', '/api/sendcloud/webhook']);

// Routes subject to strict rate limiting (auth endpoints)
const AUTH_RATE_PATHS = ['/api/auth/'];

const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "img-src 'self' data: blob: https://*.supabase.co https://imagedelivery.net",
    // style-src: Google Fonts stylesheet loaded via <link> in Layout.astro
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self' https://*.supabase.co https://api.stripe.com https://panel.sendcloud.sc",
    // font-src: Google Fonts serves .woff2 files from fonts.gstatic.com
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
].join('; ');

export const onRequest = defineMiddleware(async (context, next) => {
    const { method } = context.request;
    const { pathname } = context.url;

    // Auth code exchange — only for GET requests (except the callback itself)
    if (method === 'GET' && pathname !== '/api/auth/callback') {
        const redirectTo = await exchangeAuthCodeForSession(context.cookies, context.request, context.url);
        if (redirectTo) {
            return context.redirect(redirectTo);
        }
    }

    // Rate limiting for auth endpoints
    const isAuthPath = AUTH_RATE_PATHS.some(p => pathname.startsWith(p));
    if (isAuthPath) {
        const runtime = (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime;
        const rateLimiter = runtime?.env?.['RATE_LIMITER_AUTH'] as RateLimitBinding | undefined;
        const ip = context.request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const allowed = await checkRateLimit(rateLimiter, ip);
        if (!allowed) {
            securityLog('security.rate_limit.exceeded', { pathname, ip });
            return rateLimitResponse();
        }
    }

    // CSRF: reject cross-origin state-changing requests (M5)
    const isMutating = method === 'POST' || method === 'PATCH' || method === 'DELETE';
    if (isMutating && !WEBHOOK_PATHS.has(pathname)) {
        const origin = context.request.headers.get('Origin');
        if (origin) {
            const requestOrigin = context.url.origin;
            if (origin !== requestOrigin) {
                securityLog('security.csrf.origin_mismatch', { pathname, origin, requestOrigin });
                return new Response(JSON.stringify({ error: 'Forbidden' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
    }

    const rawResponse = await next();

    // Clone into a mutable response — some handlers (e.g. PDF downloads) return responses
    // with immutable headers (guard: "response"), which throw on .set().
    const response = new Response(rawResponse.body, {
        status: rawResponse.status,
        statusText: rawResponse.statusText,
        headers: new Headers(rawResponse.headers),
    });

    // Security headers on all responses (A1)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (context.url.protocol === 'https:') {
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/html')) {
        response.headers.set('Content-Security-Policy', CSP);
        response.headers.set('X-Frame-Options', 'DENY');
    }

    // Cache-Control (only when not already set by the handler)
    if (response.headers.has('Cache-Control')) {
        return response;
    }

    const isPrivate = PRIVATE_PREFIXES.some(p => pathname.startsWith(p));
    if (isPrivate) {
        response.headers.set('Cache-Control', 'private, no-store');
    } else {
        // M1: parse cookies properly to avoid false positives on cookie values
        const cookieHeader = context.request.headers.get('Cookie') ?? '';
        const parsed = parseCookieHeader(cookieHeader);
        const hasSession = parsed.some(
            c => c.name.startsWith('sb-') && c.name.includes('auth-token'),
        );
        response.headers.set(
            'Cache-Control',
            hasSession
                ? 'private, no-store'
                : `public, s-maxage=${PUBLIC_MAX_AGE}, stale-while-revalidate=${PUBLIC_SWR}`,
        );
    }

    return response;
});
