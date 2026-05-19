import {
    APP_MODE,
    STRIPE_SECRET_KEY_TEST,
    STRIPE_SECRET_KEY_LIVE,
    STRIPE_WEBHOOK_SECRET_TEST,
    STRIPE_WEBHOOK_SECRET_LIVE,
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
