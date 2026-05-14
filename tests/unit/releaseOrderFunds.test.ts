import { describe, it, expect, vi } from 'vitest';
import { releaseOrderFunds, type CheckoutPricedItem } from '../../src/lib/cart/checkout';

type StripeStub = {
    paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
    transfers: { create: ReturnType<typeof vi.fn> };
};

function createStripeStub(opts: {
    transferGroup?: string | null;
    transferImpl?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
} = {}): StripeStub {
    const transferGroup = 'transferGroup' in opts ? opts.transferGroup : 'tg_pre';
    const retrieve = vi.fn().mockResolvedValue({ transfer_group: transferGroup });
    const create = vi.fn(async (args: Record<string, unknown>) => {
        if (opts.transferImpl) {
            return await opts.transferImpl(args);
        }
        return { id: 'tr_' + Math.random().toString(36).slice(2) };
    });
    return {
        paymentIntents: { retrieve },
        transfers: { create },
    };
}

function priced(shopId: string, unitPrice: number, qty = 1, shipping = 0): CheckoutPricedItem {
    return {
        shopId,
        shopName: shopId,
        shopSlug: shopId,
        stripeAccountId: `acct_${shopId}`,
        quantity: qty,
        unitPrice,
        shippingCost: shipping,
    };
}

describe('releaseOrderFunds', () => {
    it('crea un transfer por cada tienda con el total agregado', async () => {
        const stripe = createStripeStub();
        const items = [
            priced('shop-a', 10, 2, 3), // 23
            priced('shop-b', 50, 1, 5), // 55
        ];

        const result = await releaseOrderFunds({
            stripe: stripe as unknown as import('stripe').default,
            orderId: 'order-1',
            publicId: 'ORD-1',
            paymentIntentId: 'pi_1',
            items,
        });

        expect(result.success).toBe(true);
        expect(stripe.transfers.create).toHaveBeenCalledTimes(2);

        const calls = stripe.transfers.create.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const shopA = calls.find(c => c.destination === 'acct_shop-a');
        const shopB = calls.find(c => c.destination === 'acct_shop-b');
        expect(shopA?.amount).toBe(2300);
        expect(shopB?.amount).toBe(5500);
        expect(shopA?.currency).toBe('eur');
        expect(shopA?.transfer_group).toBe('tg_pre');
    });

    it('usa transfer_group por publicId si el PaymentIntent no tiene uno', async () => {
        const stripe = createStripeStub({ transferGroup: null });
        await releaseOrderFunds({
            stripe: stripe as unknown as import('stripe').default,
            orderId: 'o1',
            publicId: 'ORD-XYZ',
            paymentIntentId: 'pi_1',
            items: [priced('shop-a', 10, 1, 0)],
        });

        const call = stripe.transfers.create.mock.calls[0][0] as Record<string, unknown>;
        expect(call.transfer_group).toBe('order_ORD-XYZ');
    });

    it('pasa idempotencyKey por shop para evitar dobles transferencias', async () => {
        const stripe = createStripeStub();
        await releaseOrderFunds({
            stripe: stripe as unknown as import('stripe').default,
            orderId: 'order-42',
            publicId: 'ORD-X',
            paymentIntentId: 'pi_1',
            items: [priced('shop-a', 10, 1, 0), priced('shop-b', 20, 1, 0)],
        });

        const opts = stripe.transfers.create.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);
        expect(opts[0].idempotencyKey).toMatch(/^order-transfer:order-42:shop-/);
        expect(opts[1].idempotencyKey).toMatch(/^order-transfer:order-42:shop-/);
        expect(opts[0].idempotencyKey).not.toBe(opts[1].idempotencyKey);
    });

    it('devuelve success=false con mensajes agrupados si algún transfer falla', async () => {
        const stripe = createStripeStub({
            transferImpl: (args) => {
                if ((args as { destination: string }).destination === 'acct_shop-b') {
                    return Promise.reject(new Error('destination not active'));
                }
                return { id: 'tr_ok' };
            },
        });

        const result = await releaseOrderFunds({
            stripe: stripe as unknown as import('stripe').default,
            orderId: 'o1',
            publicId: 'ORD-1',
            paymentIntentId: 'pi_1',
            items: [priced('shop-a', 10, 1, 0), priced('shop-b', 10, 1, 0)],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('shop-b');
        expect(result.error).toContain('destination not active');
    });

    it('devuelve success=false si retrieve del PaymentIntent lanza', async () => {
        const stripe = createStripeStub();
        stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Error('intent missing'));

        const result = await releaseOrderFunds({
            stripe: stripe as unknown as import('stripe').default,
            orderId: 'o1',
            publicId: 'ORD-1',
            paymentIntentId: 'pi_missing',
            items: [priced('shop-a', 10, 1, 0)],
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('intent missing');
    });
});
