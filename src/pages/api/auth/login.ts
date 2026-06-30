import type { APIRoute } from 'astro';
import { createSupabaseAuthClient, normalizeAuthRedirectPath, storePendingAuthFlowState } from '../../../lib/core/auth';

export const GET: APIRoute = async ({ locals, cookies, request, redirect, url  }) => {
    const { t } = locals;
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
