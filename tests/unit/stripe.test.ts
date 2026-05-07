import { describe, it, expect } from 'vitest';
import { getStripeAccountStatus } from '../../src/lib/stripe';

describe('getStripeAccountStatus', () => {
    it('devuelve isReady true cuando todos los flags están activos', () => {
        const account = {
            id: 'acct_123',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
        } as any;

        const status = getStripeAccountStatus(account);
        expect(status.isReady).toBe(true);
        expect(status.chargesEnabled).toBe(true);
        expect(status.payoutsEnabled).toBe(true);
        expect(status.detailsSubmitted).toBe(true);
        expect(status.stripeAccountId).toBe('acct_123');
    });

    it('devuelve isReady false si falta charges_enabled', () => {
        const account = {
            id: 'acct_123',
            charges_enabled: false,
            payouts_enabled: true,
            details_submitted: true,
        } as any;

        expect(getStripeAccountStatus(account).isReady).toBe(false);
    });

    it('devuelve isReady false si falta payouts_enabled', () => {
        const account = {
            id: 'acct_123',
            charges_enabled: true,
            payouts_enabled: false,
            details_submitted: true,
        } as any;

        expect(getStripeAccountStatus(account).isReady).toBe(false);
    });

    it('devuelve isReady false si falta details_submitted', () => {
        const account = {
            id: 'acct_123',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: false,
        } as any;

        expect(getStripeAccountStatus(account).isReady).toBe(false);
    });
});
