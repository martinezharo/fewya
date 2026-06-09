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
} from 'astro:env/server';

export type AppMode = 'development' | 'production';

export const appMode: AppMode = APP_MODE === 'production' ? 'production' : 'development';
export const isProduction = appMode === 'production';
export const isDevelopment = !isProduction;

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
