import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
    const code = url.searchParams.get('code');

    if (code) {
        const supabase = createSupabaseAuthClient(cookies, request);
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            return redirect('/?auth_error=1');
        }
    }

    return redirect('/');
};
