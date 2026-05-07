import { STRIPE_SECRET_KEY } from 'astro:env/server';
import Stripe from 'stripe';
import { strings } from '../core/i18n';

export const DEFAULT_STRIPE_ACCOUNT_COUNTRY = 'ES';

export interface StripeAccountStatus {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    isReady: boolean;
}

export function getStripeClient() {
    if (!STRIPE_SECRET_KEY) {
        throw new Error(strings.authMissingStripeEnv);
    }

    return new Stripe(STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
    });
}

export function buildAbsoluteUrl(request: Request, path: string) {
    return new URL(path, request.url).toString();
}

export function getStripeAccountStatus(account: Stripe.Account): StripeAccountStatus {
    const chargesEnabled = Boolean(account.charges_enabled);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    const detailsSubmitted = Boolean(account.details_submitted);

    return {
        stripeAccountId: account.id,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        isReady: chargesEnabled && payoutsEnabled && detailsSubmitted,
    };
}