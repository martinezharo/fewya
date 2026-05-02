import type { APIRoute } from 'astro';
import { createSupabaseAuthClient } from '../../../../lib/auth';
import { strings } from '../../../../lib/i18n';
import {
    buildAbsoluteUrl,
    DEFAULT_STRIPE_ACCOUNT_COUNTRY,
    getStripeAccountStatus,
    getStripeClient,
} from '../../../../lib/stripe';

function jsonResponse(payload: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
    const authClient = createSupabaseAuthClient(cookies, request);
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return jsonResponse({ error: strings.apiUnauthorized }, 401);
    }

    const { data: profile } = await authClient
        .from('profiles')
        .select('is_seller')
        .eq('id', user.id)
        .single();

    if (!profile?.is_seller) {
        return jsonResponse({ error: strings.apiForbidden }, 403);
    }

    const { data: shop, error: shopError } = await authClient
        .from('shops')
        .select(`
            id,
            name,
            slug,
            contact_email,
            shop_payment_accounts (
                stripe_account_id,
                charges_enabled,
                payouts_enabled,
                details_submitted
            )
        `)
        .eq('owner_id', user.id)
        .maybeSingle();

    if (shopError) {
        console.error('stripe connect shop lookup failed', shopError);
        return jsonResponse({ error: strings.apiStripeConnectError }, 500);
    }

    if (!shop) {
        return jsonResponse({ error: strings.apiShopNotFound }, 404);
    }

    let action = 'onboarding';
    let returnTo: string | null = null;
    try {
        const body = await request.json().catch(() => null) as { action?: string; returnTo?: string } | null;
        if (body?.action === 'dashboard') {
            action = 'dashboard';
        }
        if (body?.returnTo) {
            returnTo = body.returnTo;
        }
    } catch {
        action = 'onboarding';
    }

    const stripe = getStripeClient();
    const paymentAccount = one((shop as any).shop_payment_accounts);
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

        const { error: syncError } = await authClient.rpc('upsert_shop_payment_account', {
            p_shop_id: shop.id,
            p_stripe_account_id: accountStatus.stripeAccountId,
            p_charges_enabled: accountStatus.chargesEnabled,
            p_payouts_enabled: accountStatus.payoutsEnabled,
            p_details_submitted: accountStatus.detailsSubmitted,
        });

        if (syncError) {
            console.error('stripe account sync failed', syncError);
            return jsonResponse({ error: strings.apiStripeConnectError }, 500);
        }

        if (action === 'dashboard') {
            if (!accountStatus.isReady) {
                return jsonResponse({ error: strings.apiStripeDashboardUnavailable }, 409);
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

        const message = error instanceof Error ? error.message : strings.apiStripeConnectError;
        const normalizedMessage = message === strings.authMissingStripeEnv ? message : strings.apiStripeConnectError;
        return jsonResponse({ error: normalizedMessage }, 500);
    }
};