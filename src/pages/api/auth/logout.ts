import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../lib/core/auth';

export const GET: APIRoute = async ({ cookies, request, redirect }) => {
    const supabase = createSupabaseAuthClient(cookies, request);
    await supabase.auth.signOut();
    return redirect('/');
};
