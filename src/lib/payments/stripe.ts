import Stripe from 'stripe';
import { getStripeSecretKey } from '../core/env';

export const DEFAULT_STRIPE_ACCOUNT_COUNTRY = 'ES';

export interface StripeAccountStatus {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    isReady: boolean;
}

export function getStripeClient() {
    const secretKey = getStripeSecretKey();
    if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY is not configured for the current mode');
    }

    return new Stripe(secretKey, {
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