import type { APIRoute } from 'astro';
import { exchangeAuthCodeForSession, normalizeAuthRedirectPath } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
    const authRedirect = await exchangeAuthCodeForSession(cookies, request, url);

    if (authRedirect) {
        return redirect(authRedirect);
    }

    return redirect(normalizeAuthRedirectPath(url.searchParams.get('redirect_to')));
};
