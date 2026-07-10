import { describe, it, expect, vi } from 'vitest';
import { validatePayoutDestinations } from '../../src/lib/payments/payoutValidation';
import type { CheckoutPricedItem } from '../../src/lib/cart/checkout';

function priced(overrides: Partial<CheckoutPricedItem> = {}): CheckoutPricedItem {
    return {
        shopId: 'shop-1',
        shopName: 'Shop One',
        shopSlug: 'shop-one',
        stripeAccountId: 'acct_1',
        quantity: 1,
        unitPrice: 10,
        shippingCost: 2,
        ...overrides,
    };
}

function stripeStub(retrieveImpl: (accountId: string) => unknown) {
    return {
        accounts: { retrieve: vi.fn(retrieveImpl) },
    } as unknown as import('stripe').default;
}

describe('validatePayoutDestinations', () => {
    it('returns no errors and makes no calls for an empty item list', async () => {
        const stripe = stripeStub(() => ({ capabilities: { transfers: 'active' } }));
        const result = await validatePayoutDestinations(stripe, []);
        expect(result).toEqual([]);
        expect((stripe.accounts.retrieve as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('returns no errors when every destination has an active transfers capability', async () => {
        const stripe = stripeStub(() => ({ capabilities: { transfers: 'active' } }));
        const result = await validatePayoutDestinations(stripe, [priced()]);
        expect(result).toEqual([]);
    });

    it('deduplicates repeated stripe account ids so each is checked only once', async () => {
        const stripe = stripeStub(() => ({ capabilities: { transfers: 'active' } }));
        const items = [
            priced({ shopId: 'shop-1', stripeAccountId: 'acct_1' }),
            priced({ shopId: 'shop-1', stripeAccountId: 'acct_1' }),
        ];
        await validatePayoutDestinations(stripe, items);
        expect((stripe.accounts.retrieve as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    it('flags a destination whose transfers capability is not active', async () => {
        const stripe = stripeStub(() => ({ capabilities: { transfers: 'inactive' } }));
        const result = await validatePayoutDestinations(stripe, [priced({ stripeAccountId: 'acct_bad' })]);
        expect(result).toEqual([
            {
                shopId: 'shop-1',
                shopName: 'Shop One',
                stripeAccountId: 'acct_bad',
                reason: "transfers capability is 'inactive'",
            },
        ]);
    });

    it('reports "missing" when the account has no capabilities object at all', async () => {
        const stripe = stripeStub(() => ({}));
        const result = await validatePayoutDestinations(stripe, [priced()]);
        expect(result[0].reason).toBe("transfers capability is 'missing'");
    });

    it('flags a destination whose retrieve rejects with an Error', async () => {
        const stripe = stripeStub(() => {
            throw new Error('No such destination');
        });
        const result = await validatePayoutDestinations(stripe, [priced()]);
        expect(result).toEqual([
            {
                shopId: 'shop-1',
                shopName: 'Shop One',
                stripeAccountId: 'acct_1',
                reason: 'No such destination',
            },
        ]);
    });

    it('stringifies a non-Error thrown value', async () => {
        const stripe = stripeStub(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'weird failure';
        });
        const result = await validatePayoutDestinations(stripe, [priced()]);
        expect(result[0].reason).toBe('weird failure');
    });

    it('checks multiple distinct destinations independently and reports only the failing ones', async () => {
        const stripe = stripeStub((accountId: string) => {
            if (accountId === 'acct_bad') {
                throw new Error('account restricted');
            }
            return { capabilities: { transfers: 'active' } };
        });
        const items = [
            priced({ shopId: 'shop-1', shopName: 'Shop One', stripeAccountId: 'acct_good' }),
            priced({ shopId: 'shop-2', shopName: 'Shop Two', stripeAccountId: 'acct_bad' }),
        ];
        const result = await validatePayoutDestinations(stripe, items);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ shopId: 'shop-2', stripeAccountId: 'acct_bad', reason: 'account restricted' });
    });
});
