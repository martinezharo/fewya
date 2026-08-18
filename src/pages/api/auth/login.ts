import type { APIRoute } from 'astro';
import { createSupabaseAuthClient, normalizeAuthRedirectPath, storePendingAuthFlowState } from '../../../lib/core/auth';
import { convexOnly } from '../../../lib/core/env';

export const GET: APIRoute = async ({ locals, cookies, request, redirect, url  }) => {
    const { t } = locals;
    if (convexOnly) {
        const redirectTo = normalizeAuthRedirectPath(url.searchParams.get('redirect_to'));
        const target = new URL('/login', url.origin);
        target.searchParams.set('redirect_to', redirectTo);
        if (url.searchParams.get('role')) target.searchParams.set('role', url.searchParams.get('role')!);
        return redirect(`${target.pathname}${target.search}`);
    }
    const supabase = createSupabaseAuthClient(cookies, request);
    const redirectTo = normalizeAuthRedirectPath(url.searchParams.get('redirect_to'));
    const role = url.searchParams.get('role');

    storePendingAuthFlowState(cookies, url, redirectTo, role);

    const callbackUrl = new URL('/api/auth/callback', url.origin);

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: callbackUrl.toString(),
        },
    });

    if (error || !data.url) {
        return new Response(t.authGoogleLoginError, { status: 500 });
    }

    return redirect(data.url);
};
