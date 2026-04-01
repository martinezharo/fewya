import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies, request, redirect, url }) => {
    const code = url.searchParams.get('code');
    const redirectTo = url.searchParams.get('redirect_to') || '/';
    const role = url.searchParams.get('role');

    if (code) {
        const supabase = createSupabaseAuthClient(cookies, request);
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            return redirect('/?auth_error=1');
        }

        if (role === 'seller' && data.session?.user) {
            await supabase
                .from('profiles')
                .update({ is_seller: true })
                .eq('id', data.session.user.id);
        }
    }

    return redirect(redirectTo);
};
