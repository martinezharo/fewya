import type Stripe from 'stripe';
import type { CheckoutPricedItem } from '../cart/checkout';

export interface PayoutDestinationError {
    shopId: string;
    shopName: string;
    stripeAccountId: string;
    reason: string;
}

/**
 * Verify that every Stripe Connect destination referenced by `items` can accept
 * a transfer right now. Catches the common pre-transfer failures:
 *   - account doesn't exist (returns "No such destination")
 *   - account exists but `transfers` capability isn't active
 *   - account is restricted / disabled
 *
 * Returns an empty array on success; callers should refuse to commit any DB
 * state transition when the array is non-empty.
 */
export async function validatePayoutDestinations(
    stripe: Stripe,
    items: CheckoutPricedItem[],
): Promise<PayoutDestinationError[]> {
    const uniqueDestinations = new Map<string, { shopId: string; shopName: string }>();
    for (const item of items) {
        if (!uniqueDestinations.has(item.stripeAccountId)) {
            uniqueDestinations.set(item.stripeAccountId, { shopId: item.shopId, shopName: item.shopName });
        }
    }

    const errors: PayoutDestinationError[] = [];

    await Promise.all(
        Array.from(uniqueDestinations.entries()).map(async ([accountId, info]) => {
            try {
                const account = await stripe.accounts.retrieve(accountId);
                const transferCap = account.capabilities?.transfers;
                if (transferCap !== 'active') {
                    errors.push({
                        shopId: info.shopId,
                        shopName: info.shopName,
                        stripeAccountId: accountId,
                        reason: `transfers capability is '${transferCap ?? 'missing'}'`,
                    });
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errors.push({
                    shopId: info.shopId,
                    shopName: info.shopName,
                    stripeAccountId: accountId,
                    reason: message,
                });
            }
        }),
    );

    return errors;
}
