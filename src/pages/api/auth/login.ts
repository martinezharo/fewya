import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    const redirectTo = url.searchParams.get('redirect_to') || '/';
    const role = url.searchParams.get('role');

    const callbackUrl = new URL(`${url.origin}/api/auth/callback`);
    callbackUrl.searchParams.set('redirect_to', redirectTo);
    if (role) {
        callbackUrl.searchParams.set('role', role);
    }

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
