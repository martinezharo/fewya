import { defineMiddleware } from 'astro:middleware';
import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { createClerkClient, type SessionAuthObject } from '@clerk/backend';
import type { APIContext } from 'astro';
import { CLERK_JWT_TEMPLATE, CLERK_SECRET_KEY } from 'astro:env/server';
import { api } from '../convex/_generated/api';
import { createConvexClient } from './lib/core/convex';
import { getAuthRedirectPath, isAuthPage, hasRequestAuthUser, setRequestAuthUser, type AuthUser } from './lib/core/auth';
import { realEmail } from '../convex/lib/placeholderEmail';
import { securityLog } from './lib/core/security-log';
import { checkRateLimit, rateLimitResponse, type RateLimitBinding } from './lib/core/rate-limit';
import { getT, resolveLocale } from './lib/core/i18n';

const PRIVATE_PREFIXES = ['/me', '/sell', '/cart', '/profile', '/wishlist', '/api', '/login', '/sign-up'];
const PUBLIC_MAX_AGE = 60;
const PUBLIC_SWR = 300;

// Webhook routes that must not have CSRF or auth checks
const WEBHOOK_PATHS = new Set(['/api/webhooks/stripe', '/api/sendcloud/webhook']);

// Routes subject to strict rate limiting. Clerk now absorbs the sign-in
// traffic that used to live under /api/auth/, so what is left worth limiting
// is the surface that spends money on every call: Sendcloud quotes and
// service-point lookups, and Stripe checkout sessions.
const RATE_LIMITED_PREFIXES = ['/api/sendcloud/', '/api/cart/'];

// Clerk serves production assets and authentication from the custom domain.
const CLERK_CSP_SOURCES = "https://clerk.fewya.com https://*.clerk.com https://*.clerk.accounts.dev";

const CSP = [
    "default-src 'self'",
    // script-src includes `data:` because Astro's ClientRouter re-executes
    // inline <script> tags after a page swap by inserting them as
    // `data:application/javascript,...` URIs. Without `data:` the swap stalls
    // and astro:page-load never fires — event handlers stop re-binding on
    // SPA navigation. The XSS surface is essentially unchanged because
    // 'unsafe-inline' already permits inline script execution.
    `script-src 'self' 'unsafe-inline' https://js.stripe.com ${CLERK_CSP_SOURCES} https://*.protect.clerk.com https://challenges.cloudflare.com https://clerk-telemetry.com https://*.clerk-telemetry.com data:`,
    `script-src-elem 'self' 'unsafe-inline' https://js.stripe.com ${CLERK_CSP_SOURCES} https://*.protect.clerk.com https://challenges.cloudflare.com data:`,
    "worker-src 'self' blob:",
    `frame-src https://js.stripe.com https://hooks.stripe.com ${CLERK_CSP_SOURCES} https://*.protect.clerk.com https://challenges.cloudflare.com`,
    `img-src 'self' data: blob: http://127.0.0.1:3210 http://localhost:3210 https://*.convex.cloud https://*.convex.site ${CLERK_CSP_SOURCES} https://img.clerk.com https://imagedelivery.net`,
    // style-src: Google Fonts stylesheet loaded via <link> in Layout.astro
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${CLERK_CSP_SOURCES}`,
    `connect-src 'self' http://127.0.0.1:3210 http://localhost:3210 https://*.convex.cloud https://*.convex.site ${CLERK_CSP_SOURCES} https://*.protect.clerk.com https://challenges.cloudflare.com https://clerk-telemetry.com https://*.clerk-telemetry.com https://img.clerk.com https://api.stripe.com https://panel.sendcloud.sc`,
    // font-src: Google Fonts serves .woff2 files from fonts.gstatic.com
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
].join('; ');

const clerkPublishableKey = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY as string | undefined;
function getClerkBackendClient() {
    // Secret env bindings are populated by the Worker adapter after module
    // evaluation, so construct the client at request time rather than taking
    // a stale module-scope snapshot.
    return CLERK_SECRET_KEY
        ? createClerkClient({ secretKey: CLERK_SECRET_KEY, publishableKey: clerkPublishableKey })
        : null;
}
type ClerkSessionAuth = SessionAuthObject;

/**
 * True when the browser carries a Clerk session cookie. `__client_uat` is 0
 * for a signed-out client, so anything else means the visitor is (or was just)
 * signed in. Parsed by name to avoid false positives on cookie values.
 */
function hasClerkSessionCookie(request: Request): boolean {
    const header = request.headers.get('Cookie') ?? '';
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (name === '__session' && value) return true;
        if (name === '__client_uat' && value && value !== '0') return true;
    }
    return false;
}

/**
 * Resolves the caller once per request and publishes them on it.
 *
 * The identity comes from the Convex profile, not from the session token.
 * Clerk issues two different tokens here — the `convex` JWT template, which
 * carries `email`/`name`/`picture_url` and is what Convex verifies, and the
 * `__session` cookie token, whose custom claims are empty unless someone adds
 * them in the dashboard. This function used to read the second one, so every
 * field it wanted was always `undefined` and the caller's email in particular
 * fell back to a synthetic address that checkout then stamped onto the order.
 *
 * `ensureCurrent` already resolves the profile from the verified `convex`
 * token, so it returns the stored identity too. That also makes the profile
 * the single source of truth: name and avatar are editable in the account
 * page, and a session claim would go stale the moment they are.
 */
async function hydrateClerkUser(auth: () => ClerkSessionAuth, context: APIContext) {
    const clerkAuth = auth();
    if (!clerkAuth.userId) return;

    const token = await clerkAuth.getToken({ template: CLERK_JWT_TEMPLATE || 'convex' });
    if (!token) throw new Error('Clerk did not issue a Convex token');

    const convex = createConvexClient(token);
    if (!convex) throw new Error('Convex is not configured');

    const linked = await convex.mutation(api.users.ensureCurrent, {});

    const email = realEmail(linked.email);
    if (!email) {
        // The `convex` JWT template must emit `email`; without it the buyer's
        // real address never reaches checkout, Stripe or the carrier.
        console.warn(JSON.stringify({ event: 'auth.identity_without_email', subject: clerkAuth.userId }));
    }

    const user: AuthUser = {
        id: linked.legacyId,
        email,
        fullName: linked.fullName ?? undefined,
        firstName: linked.firstName ?? undefined,
        lastName: linked.lastName ?? undefined,
        avatarUrl: linked.avatarUrl ?? undefined,
    };
    setRequestAuthUser(context.request, user, token);
}

const legacyMiddleware: MiddlewareHandler = async (context, next) => {
    const { method } = context.request;
    const { pathname } = context.url;

    // Resolve the active locale (cookie override > Accept-Language > default)
    // and expose it on Astro.locals so every page/component can pull strings.
    const locale = resolveLocale({
        cookies: context.cookies,
        request: context.request,
    });
    context.locals.locale = locale;
    context.locals.t = getT(locale);

    // Rate limiting for the endpoints that call paid third-party APIs
    // Webhooks are authenticated by signature and arrive from a handful of
    // provider IPs; limiting them by IP would drop real events.
    const isRateLimited = !WEBHOOK_PATHS.has(pathname)
        && RATE_LIMITED_PREFIXES.some(p => pathname.startsWith(p));
    if (isRateLimited) {
        const rateLimiter = (env as unknown as Record<string, unknown>)?.['RATE_LIMITER'] as RateLimitBinding | undefined;
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
        // Never hand a signed-in visitor a shared cache entry. The Clerk
        // cookie is checked as well as the resolved identity so that a failed
        // identity hydration cannot downgrade the response to a public one.
        const hasSession = hasRequestAuthUser(context.request)
            || hasClerkSessionCookie(context.request);
        response.headers.set(
            'Cache-Control',
            hasSession
                ? 'private, no-store'
                : `public, s-maxage=${PUBLIC_MAX_AGE}, stale-while-revalidate=${PUBLIC_SWR}`,
        );
    }

    return response;
};

export const onRequest: MiddlewareHandler = defineMiddleware((context, next) => {
    const clerkBackendClient = getClerkBackendClient();
    if (!clerkBackendClient) {
        return legacyMiddleware(context, next);
    }

    return (async () => {
        const requestState = await clerkBackendClient.authenticateRequest(context.request, {
            acceptsToken: 'session_token',
        });
        const location = requestState.headers.get('location');
        if (location) {
            requestState.headers.set('Cache-Control', 'private, no-store');
            return new Response(null, { status: 307, headers: requestState.headers });
        }

        const authObject = requestState.toAuth();
        if (!authObject) {
            return new Response(null, { status: 401 });
        }
        (context.locals as unknown as Record<string, unknown>).auth = () => authObject;
        let identityUnavailable = false;
        try {
            await hydrateClerkUser(() => authObject, context);
        } catch (error) {
            identityUnavailable = true;
            console.error(JSON.stringify({
                event: 'clerk.identity_bridge_failed',
                error: error instanceof Error ? error.message : String(error),
            }));
        }

        const response = (await legacyMiddleware(context, async () => {
            // A valid Clerk session with an unavailable profile is not signed
            // out. Sending it back to Clerk would bounce straight here again.
            if (identityUnavailable) {
                return new Response(context.locals.t.authTemporarilyUnavailable, {
                    status: 503,
                    headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
                });
            }
            if (hasRequestAuthUser(context.request) && isAuthPage(context.url.pathname)
                && (context.request.method === 'GET' || context.request.method === 'HEAD')) {
                return context.redirect(getAuthRedirectPath(context.url));
            }
            return next();
        })) ?? new Response(null, { status: 204 });
        requestState.headers.forEach((value, key) => response.headers.append(key, value));
        return response;
    })();
});
