import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from 'astro:env/server';
import { convexOnly } from './env';

export function createSupabaseAdminClient() {
    if (convexOnly) {
        throw new Error('Supabase compatibility is disabled in Convex-only mode');
    }
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        throw new Error('SUPABASE_SECRET_KEY is required for privileged server operations');
    }

    return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}
