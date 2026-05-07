import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from 'astro:env/server';

export const supabase = typeof SUPABASE_URL === 'string' && typeof SUPABASE_KEY === 'string' 
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null as any; 
