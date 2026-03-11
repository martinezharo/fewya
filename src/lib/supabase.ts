import { createClient } from '@supabase/supabase-js';

// Usamos diferentes métodos de fallback porque Cloudflare en modo SSR 
// maneja los entornos de Build Time y Runtime de forma distinta a Node.js
const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = import.meta.env.SUPABASE_KEY || process.env.SUPABASE_KEY;

export const supabase = typeof supabaseUrl === 'string' && typeof supabaseKey === 'string' 
    ? createClient(supabaseUrl, supabaseKey)
    : null as any; // Evitamos romper el build si no existen en este instante
