import type { APIRoute } from 'astro';
import { createRequestConvexClient, getRequestUser, normalizeAuthRedirectPath } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';
import {
    buildAbsoluteUrl,
    DEFAULT_STRIPE_ACCOUNT_COUNTRY,
    getStripeAccountStatus,
    getStripeClient,
} from '../../../../lib/payments/stripe';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const POST: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const user = getRequestUser(request);
    const convex = createRequestConvexClient(request);

    if (!user || !convex) {
        return jsonResponse({ error: t.apiUnauthorized }, 401);
    }

    const onboarding = await convex.query(api.seller.onboarding, {});
    if (!onboarding?.profile?.is_seller) return jsonResponse({ error: t.apiForbidden }, 403);
    const shop = onboarding.shop;
    const paymentAccount = onboarding.paymentAccount;

    if (!shop) {
        return jsonResponse({ error: t.apiShopNotFound }, 404);
    }

    let action = 'onboarding';
    let returnTo: string | null = null;
    try {
        const body = await request.json().catch(() => null) as { action?: string; returnTo?: string } | null;
        if (body?.action === 'dashboard') {
            action = 'dashboard';
        }
        if (body?.returnTo) {
            returnTo = normalizeAuthRedirectPath(body.returnTo);
        }
    } catch {
        action = 'onboarding';
    }

    const stripe = getStripeClient();
    let stripeAccountId = paymentAccount?.stripe_account_id ?? null;

    try {
        if (!stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'express',
                country: DEFAULT_STRIPE_ACCOUNT_COUNTRY,
                email: shop.contact_email || user.email || undefined,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
                metadata: {
                    ownerId: user.id,
                    shopId: shop.id,
                    shopSlug: shop.slug,
                },
            });

            stripeAccountId = account.id;
        }

        const account = await stripe.accounts.retrieve(stripeAccountId);
        const accountStatus = getStripeAccountStatus(account);

        await convex.mutation(api.seller.syncPaymentAccount, {
            stripeAccountId: accountStatus.stripeAccountId,
            chargesEnabled: accountStatus.chargesEnabled,
            payoutsEnabled: accountStatus.payoutsEnabled,
            detailsSubmitted: accountStatus.detailsSubmitted,
        });

        if (action === 'dashboard') {
            if (!accountStatus.isReady) {
                return jsonResponse({ error: t.apiStripeDashboardUnavailable }, 409);
            }

            const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
            return jsonResponse({ url: loginLink.url, ready: true }, 200);
        }

        const returnBase = returnTo || '/sell/shop';
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: buildAbsoluteUrl(request, `${returnBase}?stripe=refresh`),
            return_url: buildAbsoluteUrl(request, `${returnBase}?stripe=return`),
            type: 'account_onboarding',
        });

        return jsonResponse({ url: accountLink.url, ready: accountStatus.isReady }, 200);
    } catch (error) {
        console.error('stripe connect flow failed', error);

        const message = error instanceof Error ? error.message : t.apiStripeConnectError;
        const normalizedMessage = message === t.authMissingStripeEnv ? message : t.apiStripeConnectError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }
};
