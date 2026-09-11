// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';

const mocks = vi.hoisted(() => ({
    authenticateRequest: vi.fn(),
    getToken: vi.fn(),
    mutation: vi.fn(),
    createConvexClient: vi.fn(),
}));

vi.mock('astro:env/server', async (importOriginal) => ({
    ...await importOriginal<typeof import('../mocks/astro-env-server')>(),
    CLERK_SECRET_KEY: 'sk_test_mock',
}));
vi.mock('@clerk/backend', () => ({
    createClerkClient: () => ({ authenticateRequest: mocks.authenticateRequest }),
}));
vi.mock('../../src/lib/core/convex', () => ({ createConvexClient: mocks.createConvexClient }));

import { onRequest } from '../../src/middleware';
import { getRequestUser, getRequestConvexToken } from '../../src/lib/core/auth';

function call(path: string) {
    const url = new URL(path, 'https://fewya.com');
    const context = {
        url,
        request: new Request(url),
        locals: {},
        cookies: { get: () => undefined },
        redirect: (location: string) => new Response(null, { status: 302, headers: { Location: location } }),
    } as unknown as APIContext;
    const next = vi.fn(async () => new Response('Page', { headers: { 'Content-Type': 'text/html' } }));
    return { context, next, response: Promise.resolve(onRequest(context, next)) };
}

describe('Clerk session routing', () => {
    beforeEach(() => {
        mocks.getToken.mockResolvedValue('convex-token');
        mocks.mutation.mockResolvedValue({ legacyId: 'profile-uuid' });
        mocks.createConvexClient.mockReturnValue({ mutation: mocks.mutation });
        mocks.authenticateRequest.mockResolvedValue({
            headers: new Headers({ 'x-clerk-auth-status': 'signed-in' }),
            toAuth: () => ({ userId: 'user_test', getToken: mocks.getToken, sessionClaims: {} }),
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

    it.each(['/login', '/sign-up', '/login/'])('returns an existing session directly from %s to its destination', async (path) => {
        const { response, context, next } = call(`${path}?redirect_to=%2Fcart%3Fcheckout%3D1`);
        const result = await response;
        expect(result?.status).toBe(302);
        expect(result?.headers.get('Location')).toBe('/cart?checkout=1');
        expect(result?.headers.get('Cache-Control')).toBe('private, no-store');
        expect(result?.headers.get('x-clerk-auth-status')).toBe('signed-in');
        expect(next).not.toHaveBeenCalled();
        expect(getRequestUser(context.request)?.id).toBe('profile-uuid');
        expect(getRequestConvexToken(context.request)).toBe('convex-token');
    });

    it('renders the requested destination without another redirect', async () => {
        const { response, next } = call('/cart');
        expect((await response)?.status).toBe(200);
        expect(next).toHaveBeenCalledOnce();
    });

    it('renders the form for an anonymous visitor', async () => {
        mocks.authenticateRequest.mockResolvedValue({
            headers: new Headers(), toAuth: () => ({ userId: null }),
        });
        const { response, next } = call('/login?redirect_to=/cart');
        const result = await response;
        expect(result?.status).toBe(200);
        expect(result?.headers.get('Cache-Control')).toBe('private, no-store');
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it.each(['profile', 'token', 'missing-token', 'configuration'])('does not turn a %s failure into a login loop', async (failure) => {
        if (failure === 'profile') mocks.mutation.mockRejectedValue(new Error('Unavailable'));
        if (failure === 'token') mocks.getToken.mockRejectedValue(new Error('Unavailable'));
        if (failure === 'missing-token') mocks.getToken.mockResolvedValue(null);
        if (failure === 'configuration') mocks.createConvexClient.mockReturnValue(null);
        const { response, context, next } = call('/me');
        const result = await response;
        expect(result?.status).toBe(503);
        expect(result?.headers.get('Location')).toBeNull();
        expect(result?.headers.get('Cache-Control')).toBe('private, no-store');
        expect(result?.headers.get('Retry-After')).toBe('5');
        expect(result?.headers.get('x-clerk-auth-status')).toBe('signed-in');
        expect(getRequestUser(context.request)).toBeNull();
        expect(next).not.toHaveBeenCalled();
    });

    it('preserves the required Clerk handshake and its cookies without caching it', async () => {
        mocks.authenticateRequest.mockResolvedValue({
            headers: new Headers({
                Location: 'https://clerk.fewya.com/v1/client/handshake',
                'Set-Cookie': '__session=refreshed; Path=/; Secure; HttpOnly',
            }),
        });
        const { response, next } = call('/me');
        const result = await response;
        expect(result?.status).toBe(307);
        expect(result?.headers.get('Location')).toContain('/handshake');
        expect(result?.headers.get('Set-Cookie')).toContain('__session=refreshed');
        expect(result?.headers.get('Cache-Control')).toBe('private, no-store');
        expect(next).not.toHaveBeenCalled();
    });
});
