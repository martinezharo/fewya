import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FUNDS_RELEASE_STATUS } from '../../src/lib/orders/orderStatus';
import type { CheckoutPricedItem } from '../../src/lib/cart/checkout';

const mockOrderItemsEq = vi.fn();
const mockOrdersUpdateEq = vi.fn();
const mockOrdersUpdate = vi.fn(() => ({ eq: mockOrdersUpdateEq }));
const mockBuildPayoutItemsFromJoins = vi.fn();
const mockGetLabelCostByShop = vi.fn();
const mockReleaseOrderFunds = vi.fn();

vi.mock('../../src/lib/cart/checkout', () => ({
    releaseOrderFunds: mockReleaseOrderFunds,
}));

vi.mock('../../src/lib/orders/orderJoins', () => ({
    buildPayoutItemsFromJoins: mockBuildPayoutItemsFromJoins,
}));

vi.mock('../../src/lib/orders/shipmentCost', () => ({
    getLabelCostByShop: mockGetLabelCostByShop,
}));

const { fetchPayoutItems, releaseAndRecord, fetchAndReleaseFunds } = await import('../../src/lib/orders/payoutFlow');

function makeAdminClient() {
    return {
        from: (table: string) => {
            if (table === 'order_items') {
                return { select: () => ({ eq: mockOrderItemsEq }) };
            }
            // orders
            return { update: mockOrdersUpdate };
        },
    } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function pricedItem(overrides: Partial<CheckoutPricedItem> = {}): CheckoutPricedItem {
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

describe('fetchPayoutItems', () => {
    let adminClient: ReturnType<typeof makeAdminClient>;

    beforeEach(() => {
        vi.clearAllMocks();
        adminClient = makeAdminClient();
    });

    it('builds payout items from the joined order_items rows', async () => {
        const rows = [{ quantity: 1 }];
        mockOrderItemsEq.mockResolvedValueOnce({ data: rows, error: null });
        const items = [pricedItem()];
        mockBuildPayoutItemsFromJoins.mockReturnValueOnce(items);

        const result = await fetchPayoutItems(adminClient, 'order-1');

        expect(mockOrderItemsEq).toHaveBeenCalledWith('order_id', 'order-1');
        expect(mockBuildPayoutItemsFromJoins).toHaveBeenCalledWith(rows);
        expect(result).toEqual({ items });
    });

    it('returns the Supabase error message when the query fails', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        const result = await fetchPayoutItems(adminClient, 'order-1');
        expect(result).toEqual({ items: [], error: 'db down' });
        expect(mockBuildPayoutItemsFromJoins).not.toHaveBeenCalled();
    });

    it('falls back to a generic error message when rows are missing without an explicit error', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: null, error: null });
        const result = await fetchPayoutItems(adminClient, 'order-1');
        expect(result).toEqual({ items: [], error: 'Could not fetch order items' });
    });
});

describe('releaseAndRecord', () => {
    let adminClient: ReturnType<typeof makeAdminClient>;
    const stripe = {} as import('stripe').default;

    beforeEach(() => {
        vi.clearAllMocks();
        adminClient = makeAdminClient();
        mockOrdersUpdateEq.mockResolvedValue({ error: null });
        mockGetLabelCostByShop.mockResolvedValue({});
        mockReleaseOrderFunds.mockResolvedValue({ success: true });
    });

    it('records a FAILED status without calling Stripe when the order has no payment intent', async () => {
        const result = await releaseAndRecord({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: null },
            items: [pricedItem()],
        });

        expect(result).toEqual({ success: false, error: 'Missing stripe_payment_intent_id' });
        expect(mockGetLabelCostByShop).not.toHaveBeenCalled();
        expect(mockReleaseOrderFunds).not.toHaveBeenCalled();
        expect(mockOrdersUpdate).toHaveBeenCalledWith({
            funds_release_status: FUNDS_RELEASE_STATUS.FAILED,
            funds_release_last_error: 'Missing stripe_payment_intent_id',
        });
        expect(mockOrdersUpdateEq).toHaveBeenCalledWith('id', 'order-1');
    });

    it('releases funds and records RELEASED status with a null error on success', async () => {
        const items = [pricedItem()];
        mockGetLabelCostByShop.mockResolvedValueOnce({ 'shop-1': 5 });
        mockReleaseOrderFunds.mockResolvedValueOnce({ success: true });

        const result = await releaseAndRecord({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
            items,
        });

        expect(mockGetLabelCostByShop).toHaveBeenCalledWith(adminClient, 'order-1');
        expect(mockReleaseOrderFunds).toHaveBeenCalledWith({
            stripe,
            orderId: 'order-1',
            publicId: 'ORD-1',
            paymentIntentId: 'pi_1',
            items,
            labelCostByShop: { 'shop-1': 5 },
        });
        expect(mockOrdersUpdate).toHaveBeenCalledWith({
            funds_release_status: FUNDS_RELEASE_STATUS.RELEASED,
            funds_release_last_error: null,
        });
        expect(result).toEqual({ success: true });
    });

    it('records FAILED status with the propagated error when the transfer fails', async () => {
        mockReleaseOrderFunds.mockResolvedValueOnce({ success: false, error: 'destination not active' });

        const result = await releaseAndRecord({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
            items: [pricedItem()],
        });

        expect(mockOrdersUpdate).toHaveBeenCalledWith({
            funds_release_status: FUNDS_RELEASE_STATUS.FAILED,
            funds_release_last_error: 'destination not active',
        });
        expect(result).toEqual({ success: false, error: 'destination not active' });
    });

    it('normalizes a missing error message to null on failure', async () => {
        mockReleaseOrderFunds.mockResolvedValueOnce({ success: false });

        await releaseAndRecord({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
            items: [pricedItem()],
        });

        expect(mockOrdersUpdate).toHaveBeenCalledWith({
            funds_release_status: FUNDS_RELEASE_STATUS.FAILED,
            funds_release_last_error: null,
        });
    });
});

describe('fetchAndReleaseFunds', () => {
    let adminClient: ReturnType<typeof makeAdminClient>;
    const stripe = {} as import('stripe').default;

    beforeEach(() => {
        vi.clearAllMocks();
        adminClient = makeAdminClient();
        mockOrdersUpdateEq.mockResolvedValue({ error: null });
        mockGetLabelCostByShop.mockResolvedValue({});
        mockReleaseOrderFunds.mockResolvedValue({ success: true });
    });

    it('short-circuits with the fetch error and never touches the order row', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });

        const result = await fetchAndReleaseFunds({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
        });

        expect(result).toEqual({ success: false, error: 'db down' });
        expect(mockOrdersUpdate).not.toHaveBeenCalled();
        expect(mockReleaseOrderFunds).not.toHaveBeenCalled();
    });

    it('fetches items and releases funds end to end on the happy path', async () => {
        const rows = [{ quantity: 2 }];
        const items = [pricedItem({ quantity: 2 })];
        mockOrderItemsEq.mockResolvedValueOnce({ data: rows, error: null });
        mockBuildPayoutItemsFromJoins.mockReturnValueOnce(items);
        mockReleaseOrderFunds.mockResolvedValueOnce({ success: true });

        const result = await fetchAndReleaseFunds({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
        });

        expect(mockReleaseOrderFunds).toHaveBeenCalledWith(expect.objectContaining({ items }));
        expect(mockOrdersUpdate).toHaveBeenCalledWith(expect.objectContaining({
            funds_release_status: FUNDS_RELEASE_STATUS.RELEASED,
        }));
        expect(result).toEqual({ success: true });
    });

    it('is idempotent-safe to retry: a previously-failed release can succeed on a later call', async () => {
        mockOrderItemsEq.mockResolvedValue({ data: [{ quantity: 1 }], error: null });
        mockBuildPayoutItemsFromJoins.mockReturnValue([pricedItem()]);

        mockReleaseOrderFunds.mockResolvedValueOnce({ success: false, error: 'transient stripe error' });
        const firstAttempt = await fetchAndReleaseFunds({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
        });
        expect(firstAttempt.success).toBe(false);
        expect(mockOrdersUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
            funds_release_status: FUNDS_RELEASE_STATUS.FAILED,
        }));

        mockReleaseOrderFunds.mockResolvedValueOnce({ success: true });
        const retry = await fetchAndReleaseFunds({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
        });
        expect(retry.success).toBe(true);
        expect(mockOrdersUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
            funds_release_status: FUNDS_RELEASE_STATUS.RELEASED,
        }));
    });

    it('records a FAILED status without calling Stripe when the order has no payment intent', async () => {
        mockOrderItemsEq.mockResolvedValueOnce({ data: [{ quantity: 1 }], error: null });
        mockBuildPayoutItemsFromJoins.mockReturnValueOnce([pricedItem()]);

        const result = await fetchAndReleaseFunds({
            adminClient,
            stripe,
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: null },
        });

        expect(result).toEqual({ success: false, error: 'Missing stripe_payment_intent_id' });
        expect(mockReleaseOrderFunds).not.toHaveBeenCalled();
    });
});
