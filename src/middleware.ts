import { defineMiddleware } from 'astro:middleware';
import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { parseCookieHeader } from '@supabase/ssr';
import { createClerkClient, type SessionAuthObject } from '@clerk/backend';
import type { APIContext } from 'astro';
import { CLERK_JWT_TEMPLATE, CLERK_SECRET_KEY } from 'astro:env/server';
import type { User } from '@supabase/supabase-js';
import { api } from '../convex/_generated/api';
import { createConvexClient } from './lib/core/convex';
import { exchangeAuthCodeForSession, hasRequestAuthUser, setRequestAuthUser } from './lib/core/auth';
import { convexOnly } from './lib/core/env';
import { securityLog } from './lib/core/security-log';
import { checkRateLimit, rateLimitResponse, type RateLimitBinding } from './lib/core/rate-limit';
import { getT, resolveLocale } from './lib/core/i18n';

const PRIVATE_PREFIXES = ['/me', '/sell', '/cart', '/profile', '/wishlist', '/api'];
const PUBLIC_MAX_AGE = 60;
const PUBLIC_SWR = 300;
const supabaseCspOrigins = convexOnly ? '' : ' https://*.supabase.co';

// Webhook routes that must not have CSRF or auth checks
const WEBHOOK_PATHS = new Set(['/api/webhooks/stripe', '/api/sendcloud/webhook']);

// Routes subject to strict rate limiting (auth endpoints)
const AUTH_RATE_PATHS = ['/api/auth/'];

const CSP = [
    "default-src 'self'",
    // script-src includes `data:` because Astro's ClientRouter re-executes
    // inline <script> tags after a page swap by inserting them as
    // `data:application/javascript,...` URIs. Without `data:` the swap stalls
    // and astro:page-load never fires — event handlers stop re-binding on
    // SPA navigation. The XSS surface is essentially unchanged because
    // 'unsafe-inline' already permits inline script execution.
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.clerk.com https://*.clerk.accounts.dev https://*.protect.clerk.com https://challenges.cloudflare.com https://clerk-telemetry.com https://*.clerk-telemetry.com data:",
    "script-src-elem 'self' 'unsafe-inline' https://js.stripe.com https://*.clerk.com https://*.clerk.accounts.dev https://*.protect.clerk.com https://challenges.cloudflare.com data:",
    "worker-src 'self' blob:",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://*.clerk.com https://*.clerk.accounts.dev https://*.protect.clerk.com https://challenges.cloudflare.com",
    `img-src 'self' data: blob: http://127.0.0.1:3210 http://localhost:3210${supabaseCspOrigins} https://*.convex.cloud https://*.convex.site https://*.clerk.com https://*.clerk.accounts.dev https://img.clerk.com https://imagedelivery.net`,
    // style-src: Google Fonts stylesheet loaded via <link> in Layout.astro
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.clerk.com https://*.clerk.accounts.dev",
    `connect-src 'self' http://127.0.0.1:3210 http://localhost:3210${supabaseCspOrigins} https://*.convex.cloud https://*.convex.site https://*.clerk.com https://*.clerk.accounts.dev https://*.protect.clerk.com https://challenges.cloudflare.com https://clerk-telemetry.com https://*.clerk-telemetry.com https://img.clerk.com https://api.stripe.com https://panel.sendcloud.sc`,
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

async function hydrateClerkUser(auth: () => ClerkSessionAuth, context: APIContext) {
    const clerkAuth = auth();
    if (!clerkAuth.userId) return;

    const token = await clerkAuth.getToken({ template: CLERK_JWT_TEMPLATE || 'convex' });
    if (!token) return;

    const claims = (clerkAuth.sessionClaims ?? {}) as Record<string, unknown>;
    const stringClaim = (...keys: string[]) => {
        for (const key of keys) {
            const value = claims[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return undefined;
    };

    const email = stringClaim('email', 'email_address');
    const fullName = stringClaim('name', 'full_name');
    const firstName = stringClaim('given_name', 'first_name');
    const lastName = stringClaim('family_name', 'last_name');
    const pictureUrl = stringClaim('picture_url', 'image_url');
    const legacyIdCandidate = crypto.randomUUID();

    const convex = createConvexClient(token);
    if (!convex) return;

    try {
        const linked = await convex.mutation(api.users.ensureCurrent, { legacyId: legacyIdCandidate });

        // During the staged production rollout this bridge keeps legacy routes
        // usable. The isolated test Worker must never write the current
        // Supabase project, so Convex is its sole identity store.
        if (linked.created && !convexOnly) {
            // Lazy import keeps the Convex-only deployment from even
            // constructing a Supabase admin client.
            const { createSupabaseAdminClient } = await import('./lib/core/supabase-admin');
            const admin = createSupabaseAdminClient();
            const { error } = await admin.from('profiles').insert({
                id: linked.legacyId,
                email: email ?? `clerk-${clerkAuth.userId}@invalid.local`,
                full_name: fullName ?? null,
                first_name: firstName ?? null,
                last_name: lastName ?? null,
                avatar_url: pictureUrl ?? null,
                address_country: 'ES',
                is_seller: false,
                email_marketing_opt_in: false,
            });
            if (error && !error.message.toLowerCase().includes('duplicate')) {
                console.error(JSON.stringify({ event: 'clerk.supabase_profile_bridge_failed', error: error.message }));
            }
        }

        const user = {
            id: linked.legacyId,
            aud: 'authenticated',
            role: 'authenticated',
            email: email ?? `clerk-${clerkAuth.userId}@invalid.local`,
            user_metadata: {
                full_name: fullName,
                first_name: firstName,
                last_name: lastName,
                avatar_url: pictureUrl,
            },
            app_metadata: { provider: 'clerk', providers: ['clerk'] },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        } as unknown as User;
        setRequestAuthUser(context.request, user, token);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'clerk.identity_bridge_failed',
            error: error instanceof Error ? error.message : String(error),
        }));
    }
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
        const rateLimiter = (env as unknown as Record<string, unknown>)?.['RATE_LIMITER_AUTH'] as RateLimitBinding | undefined;
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
        const hasSession = hasRequestAuthUser(context.request) || parsed.some(
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
            return new Response(null, { status: 307, headers: requestState.headers });
        }

        const authObject = requestState.toAuth();
        if (!authObject) {
            return new Response(null, { status: 401 });
        }
        (context.locals as unknown as Record<string, unknown>).auth = () => authObject;
        await hydrateClerkUser(() => authObject, context);

        const response = (await legacyMiddleware(context, next)) ?? new Response(null, { status: 204 });
        requestState.headers.forEach((value, key) => response.headers.append(key, value));
        return response;
    })();
});
