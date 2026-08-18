import {
    APP_MODE,
    STRIPE_SECRET_KEY_TEST,
    STRIPE_SECRET_KEY_LIVE,
    STRIPE_WEBHOOK_SECRET_TEST,
    STRIPE_WEBHOOK_SECRET_LIVE,
    APP_BASE_URL,
    RESEND_API_KEY,
    RESEND_FROM,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
    CONVEX_ONLY,
} from 'astro:env/server';
import { env as workerEnv } from 'cloudflare:workers';

export type AppMode = 'development' | 'production';

/**
 * Astro's secret env exports are refreshed by the Cloudflare adapter after the
 * module graph has been evaluated.  Values that are derived at module scope
 * therefore need to read the Worker binding directly as well; otherwise a
 * runtime `APP_MODE=development`/`CONVEX_ONLY=true` binding would still look
 * like the build-time defaults on the first request.
 */
function runtimeString(name: string): string | undefined {
    try {
        const value = (workerEnv as unknown as Record<string, unknown>)[name];
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    } catch {
        // `cloudflare:workers` is mocked/absent outside a Worker runtime. The
        // Astro env value remains the local/test fallback in that case.
        return undefined;
    }
}

const configuredAppMode = runtimeString('APP_MODE') ?? APP_MODE;
const configuredConvexOnly = runtimeString('CONVEX_ONLY') ?? CONVEX_ONLY;

export const appMode: AppMode = configuredAppMode === 'production' ? 'production' : 'development';
export const isProduction = appMode === 'production';
export const isDevelopment = !isProduction;

/**
 * Hard-disables every Supabase compatibility path for an isolated deployment.
 * This is enabled only on the test Worker while production remains staged.
 */
export const convexOnly = configuredConvexOnly === 'true';
export const supabaseCompatibilityEnabled = !convexOnly;

export function getStripeSecretKey(): string | undefined {
    return isProduction ? STRIPE_SECRET_KEY_LIVE : STRIPE_SECRET_KEY_TEST;
}

export function getStripeWebhookSecret(): string | undefined {
    return isProduction ? STRIPE_WEBHOOK_SECRET_LIVE : STRIPE_WEBHOOK_SECRET_TEST;
}

/** Public base URL of the app, used to build absolute links in emails/pushes. */
export function getAppBaseUrl(): string {
    return (APP_BASE_URL || 'https://fewya.com').replace(/\/+$/, '');
}

export function getResendApiKey(): string | undefined {
    return RESEND_API_KEY;
}

export function getResendFrom(): string {
    return RESEND_FROM || 'Fewya <no-reply@fewya.com>';
}

export interface VapidConfig {
    subject: string;
    publicKey: string;
    privateKey: string;
}

/** Returns VAPID config only when both keys are present; otherwise null. */
export function getVapidConfig(): VapidConfig | null {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
    return {
        subject: VAPID_SUBJECT || 'mailto:no-reply@fewya.com',
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
    };
}

export function getVapidPublicKey(): string | undefined {
    return VAPID_PUBLIC_KEY;
}
