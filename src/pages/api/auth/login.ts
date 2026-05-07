import type { APIRoute } from 'astro';
import { createSupabaseAuthClient, normalizeAuthRedirectPath, storePendingAuthFlowState } from '../../../lib/core/auth';
import { strings } from '../../../lib/core/i18n';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
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
        return new Response(strings.authGoogleLoginError, { status: 500 });
    }

    return redirect(data.url);
};
