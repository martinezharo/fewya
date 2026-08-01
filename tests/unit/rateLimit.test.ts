import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, rateLimitResponse, type RateLimitBinding } from '../../src/lib/core/rate-limit';

/**
 * A rate limiter is only worth testing at its failure modes. That it says "no"
 * to the twenty-first request is Cloudflare's job; what belongs here is what
 * happens when the limiter itself cannot answer — because the wrong choice
 * there is silent, and it is silent precisely when someone is hammering the
 * auth endpoints.
 */

// The module reads `isProduction` at call time from a module-level constant, so
// each environment has to be imported fresh.
async function loadWithMode(mode: 'production' | 'development') {
    vi.resetModules();
    vi.doMock('../../src/lib/core/env', () => ({
        isProduction: mode === 'production',
        isDevelopment: mode === 'development',
        appMode: mode,
    }));
    return await import('../../src/lib/core/rate-limit');
}

const allowing: RateLimitBinding = { limit: async () => ({ success: true }) };
const denying: RateLimitBinding = { limit: async () => ({ success: false }) };

describe('checkRateLimit', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.doUnmock('../../src/lib/core/env');
        vi.resetModules();
    });

    describe('when the binding works', () => {
        it('allows a request the limiter accepts', async () => {
            expect(await checkRateLimit(allowing, '1.2.3.4')).toBe(true);
        });

        it('denies a request the limiter rejects', async () => {
            expect(await checkRateLimit(denying, '1.2.3.4')).toBe(false);
        });

        it('passes the key through unchanged', async () => {
            // The key is the client IP. Mangling it would bucket every caller
            // together, which either rate-limits the whole site at once or
            // (worse) never trips at all.
            const limit = vi.fn(async () => ({ success: true }));
            await checkRateLimit({ limit }, '203.0.113.7');
            expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
        });
    });

    describe('when the binding is missing', () => {
        it('denies in production rather than dropping the limit entirely', async () => {
            // The case this whole file exists for. A binding renamed in
            // wrangler.jsonc, or not redeclared in an environment (they are not
            // inherited), used to mean unlimited auth attempts with nothing in
            // the logs to say so.
            const mod = await loadWithMode('production');
            expect(await mod.checkRateLimit(undefined, '1.2.3.4')).toBe(false);
        });

        it('says so in the security log', async () => {
            const mod = await loadWithMode('production');
            await mod.checkRateLimit(undefined, '1.2.3.4');
            expect(warn).toHaveBeenCalledOnce();
            const logged = JSON.parse(warn.mock.calls[0][0] as string);
            expect(logged.event).toBe('security.rate_limit.unavailable');
            expect(logged.reason).toBe('binding_missing');
        });

        it('allows in development, where there is no binding to have', async () => {
            // `astro dev` runs without the Workers runtime. Failing closed here
            // would mean nobody could log in locally.
            const mod = await loadWithMode('development');
            expect(await mod.checkRateLimit(undefined, '1.2.3.4')).toBe(true);
            expect(warn).not.toHaveBeenCalled();
        });
    });

    describe('when the binding misbehaves', () => {
        it('denies when limit() throws, instead of letting the error through', async () => {
            // An unhandled rejection here would surface as a 500 on the login
            // route — technically not "unlimited", but it turns a rate-limit
            // outage into an auth outage, and logs nothing useful.
            const binding = { limit: async () => { throw new Error('binding exploded'); } };
            expect(await checkRateLimit(binding, '1.2.3.4')).toBe(false);
        });

        it('logs the underlying error', async () => {
            const binding = { limit: async () => { throw new Error('binding exploded'); } };
            await checkRateLimit(binding, '1.2.3.4');
            const logged = JSON.parse(warn.mock.calls[0][0] as string);
            expect(logged.event).toBe('security.rate_limit.unavailable');
            expect(logged.reason).toBe('binding_error');
            expect(logged.error).toBe('binding exploded');
        });

        it('denies when the answer has no success field', async () => {
            // `const { success } = result` on a malformed answer yields
            // undefined, which a `return success` would have handed back as a
            // falsy — correct by accident. Asserted so it stays correct on
            // purpose.
            const binding = { limit: async () => ({}) } as unknown as RateLimitBinding;
            expect(await checkRateLimit(binding, '1.2.3.4')).toBe(false);
        });

        it('denies when the answer is not an object at all', async () => {
            const binding = { limit: async () => null } as unknown as RateLimitBinding;
            expect(await checkRateLimit(binding, '1.2.3.4')).toBe(false);
        });

        it('does not accept a truthy non-boolean as consent', async () => {
            const binding = { limit: async () => ({ success: 'yes' }) } as unknown as RateLimitBinding;
            expect(await checkRateLimit(binding, '1.2.3.4')).toBe(false);
        });
    });
});

describe('rateLimitResponse', () => {
    it('is a 429 with a Retry-After the client can act on', async () => {
        const response = rateLimitResponse();
        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('60');
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(await response.json()).toEqual({
            error: 'Demasiadas solicitudes. Inténtalo más tarde.',
        });
    });
});
