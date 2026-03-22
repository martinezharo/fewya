import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';
import { strings } from '../../../lib/i18n';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
    const supabase = createSupabaseAuthClient(cookies, request);

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${url.origin}/api/auth/callback`,
        },
    });

    if (error || !data.url) {
        return new Response(strings.authGoogleLoginError, { status: 500 });
    }

    return redirect(data.url);
};
