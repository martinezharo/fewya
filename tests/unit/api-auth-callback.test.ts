import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExchange = vi.fn();

vi.mock('../../src/lib/core/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/lib/core/auth')>();
    return {
        ...actual,
        exchangeAuthCodeForSession: mockExchange,
    };
});

const { GET } = await import('../../src/pages/api/auth/callback');

function call(urlString: string) {
    const url = new URL(urlString);
    const request = new Request(urlString);
    const redirect = vi.fn((path: string) =>
        new Response(null, { status: 302, headers: { Location: path } })
    );
    const cookies = {};
    return {
        response: GET({ cookies, request, redirect, url } as any),
        redirect,
        cookies,
        request,
        url,
    };
}

describe('GET /api/auth/callback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExchange.mockResolvedValue(null);
    });

    it('redirects to the path resolved by the auth code exchange', async () => {
        mockExchange.mockResolvedValueOnce('/me/details?welcome=1');
        const { response, redirect } = call('https://fewya.com/api/auth/callback?code=abc');
        const res = await response;
        expect(redirect).toHaveBeenCalledWith('/me/details?welcome=1');
        expect(res.headers.get('Location')).toBe('/me/details?welcome=1');
    });

    it('passes cookies, request and url through to the exchange', async () => {
        const { response, cookies, request, url } = call('https://fewya.com/api/auth/callback?code=abc');
        await response;
        expect(mockExchange).toHaveBeenCalledWith(cookies, request, url);
    });

    it('falls back to the redirect_to query param when there is no exchange result', async () => {
        const { response, redirect } = call('https://fewya.com/api/auth/callback?redirect_to=%2Fme%2Forders');
        await response;
        expect(redirect).toHaveBeenCalledWith('/me/orders');
    });

    it('normalizes an external redirect_to to the home page (open-redirect guard)', async () => {
        const { redirect: r1, response: p1 } = call('https://fewya.com/api/auth/callback?redirect_to=https%3A%2F%2Fevil.com');
        await p1;
        expect(r1).toHaveBeenCalledWith('/');

        const { redirect: r2, response: p2 } = call('https://fewya.com/api/auth/callback?redirect_to=%2F%2Fevil.com');
        await p2;
        expect(r2).toHaveBeenCalledWith('/');
    });

    it('redirects to the home page when no redirect target is available', async () => {
        const { response, redirect } = call('https://fewya.com/api/auth/callback');
        await response;
        expect(redirect).toHaveBeenCalledWith('/');
    });
});
