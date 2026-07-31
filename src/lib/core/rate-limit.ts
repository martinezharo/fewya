import { isProduction } from './env';
import { securityLog } from './security-log';

export interface RateLimitBinding {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Checks a request against a Cloudflare Rate Limiting binding.
 *
 * The interesting question here is not what happens when the limiter works, but
 * what happens when it does not. A rate limiter that answers "allow" whenever it
 * is broken protects nothing: the one moment it matters — someone hammering
 * `/api/auth/` — is also the moment it is most likely to be under strain, and a
 * binding that has been renamed, dropped from an environment, or is simply
 * throwing would hand out unlimited attempts while looking perfectly healthy.
 *
 * So the failure modes are separated:
 *
 * - **Binding missing.** In production this is a deployment mistake, and the
 *   safe reading of "I cannot tell whether you are over the limit" is *no*.
 *   Under `astro dev` there is no binding at all, and failing closed there would
 *   mean nobody could log in locally — so development allows, and says so.
 * - **Binding throws.** Never a normal condition. Denied and logged, in every
 *   environment.
 * - **Binding answers something malformed.** Treated as a denial rather than
 *   coerced into an allow: a missing `success` field is not consent.
 */
export async function checkRateLimit(
    binding: RateLimitBinding | undefined,
    key: string,
): Promise<boolean> {
    if (!binding) {
        if (isProduction) {
            securityLog('security.rate_limit.unavailable', { key, reason: 'binding_missing' });
            return false;
        }
        return true;
    }

    try {
        const result = await binding.limit({ key });
        return result?.success === true;
    } catch (error) {
        securityLog('security.rate_limit.unavailable', {
            key,
            reason: 'binding_error',
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
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
