import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The middleware is the only code every single request passes through, and it
 * is where four separate security decisions live: which routes skip CSRF, when
 * the auth rate limiter runs, which responses get a CSP, and — the one with the
 * widest blast radius — which responses may be cached by a shared cache.
 *
 * That last one is why this file exists. A `public, s-maxage=…` on a response
 * that turned out to be personalised does not fail loudly; it puts one user's
 * page in a CDN and serves it to the next.
 */

const exchangeAuthCodeForSession = vi.fn(async () => null as string | null);
vi.mock('../../src/lib/core/auth', () => ({ exchangeAuthCodeForSession }));

// Same file the `cloudflare:workers` alias resolves to, so mutating this `env`
// is what the middleware sees when it looks for its rate limiter binding.
const { env } = await import('../mocks/cloudflare-workers');
const { onRequest } = await import('../../src/middleware');

type Handler = (context: any, next: () => Promise<Response>) => Promise<Response>;
const middleware = onRequest as unknown as Handler;

interface CallOptions {
    method?: string;
    headers?: Record<string, string>;
    /** What the downstream route returns. Defaults to an HTML page. */
    response?: Response;
}

/**
 * A minimal stand-in for the parts of APIContext the middleware touches.
 *
 * The request is a plain object rather than a real `Request` on purpose:
 * `Origin` and `Cookie` are forbidden header names, so the fetch constructor
 * drops them silently — and those two are exactly what the CSRF and caching
 * decisions are made from. A hand-built `Headers` keeps them.
 */
function contextFor(url: string, { method = 'GET', headers = {} }: CallOptions = {}) {
    const parsed = new URL(url);
    const request = { method, headers: new Headers(headers) };
    const store = new Map<string, string>();
    return {
        request,
        url: parsed,
        locals: {} as Record<string, unknown>,
        cookies: {
            get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
            set: (name: string, value: string) => store.set(name, value),
            delete: (name: string) => store.delete(name),
            has: (name: string) => store.has(name),
        },
        redirect: (location: string) =>
            new Response(null, { status: 302, headers: { Location: location } }),
    };
}

function htmlResponse(extraHeaders: Record<string, string> = {}) {
    return new Response('<html></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
    });
}

async function call(url: string, options: CallOptions = {}) {
    const context = contextFor(url, options);
    const response = await middleware(context, async () => options.response ?? htmlResponse());
    return { response, context };
}

describe('middleware', () => {
    beforeEach(() => {
        exchangeAuthCodeForSession.mockResolvedValue(null);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const key of Object.keys(env)) delete env[key];
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    describe('locale', () => {
        it('exposes a locale and a translator to every route', async () => {
            const { context } = await call('https://fewya.com/');
            expect(context.locals.locale).toBeTruthy();
            expect(context.locals.t).toBeTruthy();
        });
    });

    describe('CSRF', () => {
        const mutating = ['POST', 'PATCH', 'DELETE'] as const;

        it.each(mutating)('rejects a cross-origin %s with 403', async (method) => {
            const { response } = await call('https://fewya.com/api/cart/add', {
                method,
                headers: { Origin: 'https://evil.example' },
            });
            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({ error: 'Forbidden' });
        });

        it('allows a same-origin POST', async () => {
            const { response } = await call('https://fewya.com/api/cart/add', {
                method: 'POST',
                headers: { Origin: 'https://fewya.com' },
            });
            expect(response.status).toBe(200);
        });

        it('allows a POST with no Origin header', async () => {
            // Not every legitimate client sends one, and the check is a
            // defence-in-depth measure on top of SameSite cookies rather than
            // the only thing standing between a request and a write.
            const { response } = await call('https://fewya.com/api/cart/add', { method: 'POST' });
            expect(response.status).toBe(200);
        });

        it('does not touch a cross-origin GET', async () => {
            const { response } = await call('https://fewya.com/products', {
                headers: { Origin: 'https://evil.example' },
            });
            expect(response.status).toBe(200);
        });

        it.each(['/api/webhooks/stripe', '/api/sendcloud/webhook'])(
            'exempts %s, which is signed rather than same-origin',
            async (pathname) => {
                // Stripe and Sendcloud post from their own servers, so an
                // Origin check would reject every real webhook. They carry
                // signatures instead, verified by the route itself.
                const { response } = await call(`https://fewya.com${pathname}`, {
                    method: 'POST',
                    headers: { Origin: 'https://stripe.com' },
                });
                expect(response.status).toBe(200);
            },
        );

        it('does not extend the webhook exemption to lookalike paths', async () => {
            // The exemption is an exact-match Set, and it must stay one: a
            // prefix check would hand `/api/webhooks/stripe/../transfer` the
            // same free pass.
            for (const pathname of [
                '/api/webhooks/stripe/extra',
                '/api/webhooks/stripe2',
                '/api/webhooks',
            ]) {
                const { response } = await call(`https://fewya.com${pathname}`, {
                    method: 'POST',
                    headers: { Origin: 'https://evil.example' },
                });
                expect(response.status, pathname).toBe(403);
            }
        });
    });

    describe('rate limiting', () => {
        it('applies to auth endpoints', async () => {
            env.RATE_LIMITER_AUTH = { limit: async () => ({ success: false }) };
            const { response } = await call('https://fewya.com/api/auth/signin', { method: 'POST' });
            expect(response.status).toBe(429);
            expect(response.headers.get('Retry-After')).toBe('60');
        });

        it('lets an allowed auth request through', async () => {
            env.RATE_LIMITER_AUTH = { limit: async () => ({ success: true }) };
            const { response } = await call('https://fewya.com/api/auth/signin', { method: 'POST' });
            expect(response.status).toBe(200);
        });

        it('keys the limiter on the client IP', async () => {
            const limit = vi.fn(async () => ({ success: true }));
            env.RATE_LIMITER_AUTH = { limit };
            await call('https://fewya.com/api/auth/signin', {
                method: 'POST',
                headers: { 'CF-Connecting-IP': '203.0.113.9' },
            });
            expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
        });

        it('falls back to a constant key when the IP header is absent', async () => {
            // Everyone shares one bucket, which is blunt but closed. Reading
            // an attacker-supplied header such as X-Forwarded-For instead would
            // let each request invent its own bucket and never trip.
            const limit = vi.fn(async () => ({ success: true }));
            env.RATE_LIMITER_AUTH = { limit };
            await call('https://fewya.com/api/auth/signin', {
                method: 'POST',
                headers: { 'X-Forwarded-For': '203.0.113.9' },
            });
            expect(limit).toHaveBeenCalledWith({ key: 'unknown' });
        });

        it('does not rate limit non-auth routes', async () => {
            const limit = vi.fn(async () => ({ success: false }));
            env.RATE_LIMITER_AUTH = { limit };
            const { response } = await call('https://fewya.com/api/cart/add', { method: 'POST' });
            expect(limit).not.toHaveBeenCalled();
            expect(response.status).toBe(200);
        });

        it('rate limits GETs to auth routes too', async () => {
            // The OAuth callback is a GET, and it is as worth limiting as the
            // sign-in POST.
            env.RATE_LIMITER_AUTH = { limit: async () => ({ success: false }) };
            const { response } = await call('https://fewya.com/api/auth/callback?code=x');
            expect(response.status).toBe(429);
        });
    });

    describe('auth code exchange', () => {
        it('redirects when a code is exchanged successfully', async () => {
            exchangeAuthCodeForSession.mockResolvedValue('/me');
            const { response } = await call('https://fewya.com/?code=abc');
            expect(response.status).toBe(302);
            expect(response.headers.get('Location')).toBe('/me');
        });

        it('leaves the callback route to handle its own code', async () => {
            // Running the exchange here as well would consume a single-use code
            // before the route that exists to consume it ever saw it.
            await call('https://fewya.com/api/auth/callback?code=abc');
            expect(exchangeAuthCodeForSession).not.toHaveBeenCalled();
        });

        it('does not attempt an exchange on a POST', async () => {
            await call('https://fewya.com/?code=abc', { method: 'POST' });
            expect(exchangeAuthCodeForSession).not.toHaveBeenCalled();
        });
    });

    describe('security headers', () => {
        it('sets the baseline headers on every response', async () => {
            const { response } = await call('https://fewya.com/api/products', {
                response: new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
            });
            expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
            expect(response.headers.get('Permissions-Policy')).toBe(
                'camera=(), microphone=(), geolocation=()',
            );
        });

        it('sets HSTS over https', async () => {
            const { response } = await call('https://fewya.com/');
            expect(response.headers.get('Strict-Transport-Security')).toBe(
                'max-age=31536000; includeSubDomains',
            );
        });

        it('omits HSTS over http, where it would be meaningless', async () => {
            const { response } = await call('http://localhost:4321/');
            expect(response.headers.get('Strict-Transport-Security')).toBeNull();
        });

        it('sets the CSP and frame denial on HTML', async () => {
            const { response } = await call('https://fewya.com/');
            const csp = response.headers.get('Content-Security-Policy') ?? '';
            expect(csp).toContain("default-src 'self'");
            expect(csp).toContain("object-src 'none'");
            expect(response.headers.get('X-Frame-Options')).toBe('DENY');
        });

        it('allows exactly the third parties the app actually loads', async () => {
            // Pinned deliberately: widening any of these is a security decision
            // and should not pass unnoticed in a diff.
            const { response } = await call('https://fewya.com/');
            const csp = response.headers.get('Content-Security-Policy') ?? '';
            expect(csp).toContain('script-src \'self\' \'unsafe-inline\' https://js.stripe.com data:');
            expect(csp).toContain('frame-src https://js.stripe.com https://hooks.stripe.com');
            expect(csp).toContain('font-src \'self\' https://fonts.gstatic.com');
            expect(csp).toContain(
                "connect-src 'self' https://*.supabase.co https://api.stripe.com https://panel.sendcloud.sc",
            );
        });

        it('does not put a CSP on non-HTML responses', async () => {
            // A CSP on a JSON body or a PDF does nothing but add bytes to every
            // API response.
            const { response } = await call('https://fewya.com/api/products', {
                response: new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
            });
            expect(response.headers.get('Content-Security-Policy')).toBeNull();
            expect(response.headers.get('X-Frame-Options')).toBeNull();
        });

        it('can rewrite headers on a response that arrived immutable', async () => {
            // Responses built by some handlers (PDF downloads) have guarded
            // headers that throw on `.set()`. The middleware clones first; this
            // is the regression test for that clone.
            const immutable = new Response('%PDF-1.4', {
                headers: { 'Content-Type': 'application/pdf' },
            });
            Object.defineProperty(immutable.headers, 'set', {
                value: () => {
                    throw new TypeError('immutable headers');
                },
            });
            const { response } = await call('https://fewya.com/api/label.pdf', {
                response: immutable,
            });
            expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(await response.text()).toBe('%PDF-1.4');
        });

        it('preserves the downstream status and body', async () => {
            const { response } = await call('https://fewya.com/missing', {
                response: new Response('nope', { status: 404, statusText: 'Not Found' }),
            });
            expect(response.status).toBe(404);
            expect(await response.text()).toBe('nope');
        });
    });

    describe('caching', () => {
        const privatePrefixes = ['/me', '/sell', '/cart', '/profile', '/wishlist', '/api'];

        it.each(privatePrefixes)('never caches %s publicly', async (prefix) => {
            const { response } = await call(`https://fewya.com${prefix}/anything`);
            expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        });

        it('caches an anonymous public page at the edge', async () => {
            const { response } = await call('https://fewya.com/products/widget');
            expect(response.headers.get('Cache-Control')).toBe(
                'public, s-maxage=60, stale-while-revalidate=300',
            );
        });

        it('does not cache a public page for a signed-in visitor', async () => {
            // The whole point: a personalised header on a "public" page must
            // not be stored by a shared cache and handed to the next visitor.
            const { response } = await call('https://fewya.com/products/widget', {
                headers: { Cookie: 'sb-abcdef-auth-token=xyz' },
            });
            expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        });

        it('is not fooled by a session-looking string inside a cookie value', async () => {
            // The reason cookies are parsed rather than string-matched: a
            // harmless cookie whose *value* mentions an auth token used to
            // suppress caching for everyone who had one.
            const { response } = await call('https://fewya.com/products/widget', {
                headers: { Cookie: 'cart=sb-abcdef-auth-token; locale=es' },
            });
            expect(response.headers.get('Cache-Control')).toBe(
                'public, s-maxage=60, stale-while-revalidate=300',
            );
        });

        it('ignores unrelated sb- cookies', async () => {
            const { response } = await call('https://fewya.com/products/widget', {
                headers: { Cookie: 'sb-abcdef-locale=es' },
            });
            expect(response.headers.get('Cache-Control')).toBe(
                'public, s-maxage=60, stale-while-revalidate=300',
            );
        });

        it('leaves a Cache-Control the handler already chose', async () => {
            // A route that knows its own freshness — an immutable asset, a feed
            // with its own TTL — must not have it overwritten from here.
            const { response } = await call('https://fewya.com/products/widget', {
                response: htmlResponse({ 'Cache-Control': 'public, max-age=31536000, immutable' }),
            });
            expect(response.headers.get('Cache-Control')).toBe(
                'public, max-age=31536000, immutable',
            );
        });

        it('still applies security headers when the handler set its own caching', async () => {
            // The early return for an existing Cache-Control happens after the
            // security headers, and must stay there.
            const { response } = await call('https://fewya.com/', {
                response: htmlResponse({ 'Cache-Control': 'no-store' }),
            });
            expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
        });
    });
});
