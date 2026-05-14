export interface RateLimitBinding {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Checks if a request is within rate limits using a Cloudflare Rate Limiting binding.
 * Returns true (allow) when no binding is configured — enables zero-config dev.
 * Configure the binding in wrangler.jsonc [[rate_limiting]] and the Cloudflare dashboard.
 */
export async function checkRateLimit(
    binding: RateLimitBinding | undefined,
    key: string,
): Promise<boolean> {
    if (!binding) return true;
    const { success } = await binding.limit({ key });
    return success;
}

export function rateLimitResponse(): Response {
    return new Response(JSON.stringify({ error: 'Demasiadas solicitudes. Inténtalo más tarde.' }), {
        status: 429,
        headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
        },
    });
}
