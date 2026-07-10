import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchAndReleaseFunds = vi.fn();
const mockEligibleFetch = vi.fn();
const mockRetryFetch = vi.fn();
const mockOrdersUpdate = vi.fn();
const mockOrdersUpdateIn = vi.fn();
const mockOrdersUpdateEq = vi.fn();

let selectCallCount = 0;

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: (_table: string) => ({
            select: (...args: unknown[]) => {
                selectCallCount += 1;
                if (selectCallCount === 1) {
                    // Phase 1: eligible-for-auto-confirm query.
                    return {
                        eq: (...eqArgs: unknown[]) => ({
                            lt: (...ltArgs: unknown[]) => ({
                                is: (...isArgs: unknown[]) => mockEligibleFetch(...args, ...eqArgs, ...ltArgs, ...isArgs),
                            }),
                        }),
                    };
                }
                // Phase 2: retry-failed-release query.
                return { eq: (...eqArgs: unknown[]) => mockRetryFetch(...args, ...eqArgs) };
            },
            update: (payload: unknown) => {
                mockOrdersUpdate(payload);
                return {
                    in: (col: string, ids: string[]) => {
                        mockOrdersUpdateIn(col, ids);
                        return { eq: (col2: string, val2: string) => mockOrdersUpdateEq(col2, val2) };
                    },
                };
            },
        }),
    }),
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({ __stub: 'stripe' }),
}));

vi.mock('../../src/lib/orders/payoutFlow', () => ({
    fetchAndReleaseFunds: mockFetchAndReleaseFunds,
}));

const { runAutoConfirm } = await import('../../src/lib/orders/autoConfirm');

function eligibleOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 'order-1',
        public_id: 'ORD-1',
        stripe_payment_intent_id: 'pi_1',
        ...overrides,
    };
}

describe('runAutoConfirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectCallCount = 0;
        mockEligibleFetch.mockResolvedValue({ data: [], error: null });
        mockRetryFetch.mockResolvedValue({ data: [], error: null });
        mockOrdersUpdateEq.mockResolvedValue({ error: null });
        mockFetchAndReleaseFunds.mockResolvedValue({ success: true });
    });

    it('throws and skips everything else when the eligible-orders fetch fails', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
        await expect(runAutoConfirm()).rejects.toThrow('db down');
        expect(mockOrdersUpdate).not.toHaveBeenCalled();
        expect(mockRetryFetch).not.toHaveBeenCalled();
        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
    });

    it('treats a null eligible-orders payload (no rows, no error) as nothing to confirm', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: null, error: null });
        const report = await runAutoConfirm();
        expect(report.autoConfirmed).toBe(0);
        expect(mockOrdersUpdate).not.toHaveBeenCalled();
    });

    it('treats a null retry-orders payload (no rows, no error) as nothing to retry', async () => {
        mockRetryFetch.mockResolvedValueOnce({ data: null, error: null });
        const report = await runAutoConfirm();
        expect(report.retried).toBe(0);
        expect(report.retriedReleased).toEqual([]);
        expect(report.retriedFailed).toEqual([]);
    });

    it('returns all-zero counters when there is nothing to confirm or retry', async () => {
        const report = await runAutoConfirm();
        expect(report).toEqual({
            autoConfirmed: 0,
            released: [],
            failed: [],
            retried: 0,
            retriedReleased: [],
            retriedFailed: [],
        });
        expect(mockOrdersUpdate).not.toHaveBeenCalled();
        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
    });

    it('throws when marking eligible orders as confirmed fails, without attempting fund release', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: [eligibleOrder()], error: null });
        mockOrdersUpdateEq.mockResolvedValueOnce({ error: { message: 'update failed' } });

        await expect(runAutoConfirm()).rejects.toThrow('update failed');
        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
    });

    it('confirms an eligible order and releases its funds on the happy path', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: [eligibleOrder()], error: null });
        mockFetchAndReleaseFunds.mockResolvedValueOnce({ success: true });

        const report = await runAutoConfirm();

        expect(mockOrdersUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
        expect(mockOrdersUpdateIn).toHaveBeenCalledWith('id', ['order-1']);
        expect(mockOrdersUpdateEq).toHaveBeenCalledWith('status', 'delivered');
        expect(mockFetchAndReleaseFunds).toHaveBeenCalledWith(expect.objectContaining({
            order: { id: 'order-1', public_id: 'ORD-1', stripe_payment_intent_id: 'pi_1' },
        }));
        expect(report.autoConfirmed).toBe(1);
        expect(report.released).toEqual(['ORD-1']);
        expect(report.failed).toEqual([]);
    });

    it('marks an order as failed without calling Stripe when it has no payment intent', async () => {
        mockEligibleFetch.mockResolvedValueOnce({
            data: [eligibleOrder({ stripe_payment_intent_id: null })],
            error: null,
        });

        const report = await runAutoConfirm();

        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
        expect(report.failed).toEqual(['ORD-1']);
        expect(report.released).toEqual([]);
    });

    it('records a failure when the fund release itself fails, without throwing', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: [eligibleOrder()], error: null });
        mockFetchAndReleaseFunds.mockResolvedValueOnce({ success: false, error: 'destination not active' });

        const report = await runAutoConfirm();

        expect(report.failed).toEqual(['ORD-1']);
        expect(report.released).toEqual([]);
    });

    it('handles a mix of successful and failed releases across multiple eligible orders independently', async () => {
        mockEligibleFetch.mockResolvedValueOnce({
            data: [
                eligibleOrder({ id: 'order-1', public_id: 'ORD-1' }),
                eligibleOrder({ id: 'order-2', public_id: 'ORD-2' }),
            ],
            error: null,
        });
        mockFetchAndReleaseFunds
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: 'boom' });

        const report = await runAutoConfirm();

        expect(report.autoConfirmed).toBe(2);
        expect(report.released).toEqual(['ORD-1']);
        expect(report.failed).toEqual(['ORD-2']);
    });

    it('logs but does not throw when the retry-fetch query itself fails', async () => {
        mockRetryFetch.mockResolvedValueOnce({ data: null, error: { message: 'retry query failed' } });
        const report = await runAutoConfirm();
        expect(report.retried).toBe(0);
        expect(report.retriedReleased).toEqual([]);
        expect(report.retriedFailed).toEqual([]);
    });

    it('recovers a previously-failed release on retry (idempotent via transfer_group)', async () => {
        mockRetryFetch.mockResolvedValueOnce({
            data: [eligibleOrder({ id: 'order-9', public_id: 'ORD-9' })],
            error: null,
        });
        mockFetchAndReleaseFunds.mockResolvedValueOnce({ success: true });

        const report = await runAutoConfirm();

        expect(mockFetchAndReleaseFunds).toHaveBeenCalledWith(expect.objectContaining({
            order: { id: 'order-9', public_id: 'ORD-9', stripe_payment_intent_id: 'pi_1' },
        }));
        expect(report.retried).toBe(1);
        expect(report.retriedReleased).toEqual(['ORD-9']);
        expect(report.retriedFailed).toEqual([]);
    });

    it('marks a retry order as still-failing without calling Stripe when it has no payment intent', async () => {
        mockRetryFetch.mockResolvedValueOnce({
            data: [eligibleOrder({ id: 'order-9', public_id: 'ORD-9', stripe_payment_intent_id: null })],
            error: null,
        });

        const report = await runAutoConfirm();

        expect(mockFetchAndReleaseFunds).not.toHaveBeenCalled();
        expect(report.retriedFailed).toEqual(['ORD-9']);
        expect(report.retriedReleased).toEqual([]);
    });

    it('keeps a retry order in retriedFailed when the release attempt fails again', async () => {
        mockRetryFetch.mockResolvedValueOnce({
            data: [eligibleOrder({ id: 'order-9', public_id: 'ORD-9' })],
            error: null,
        });
        mockFetchAndReleaseFunds.mockResolvedValueOnce({ success: false, error: 'still broken' });

        const report = await runAutoConfirm();

        expect(report.retriedFailed).toEqual(['ORD-9']);
        expect(report.retriedReleased).toEqual([]);
    });

    it('runs the auto-confirm phase and the retry phase independently in the same invocation', async () => {
        mockEligibleFetch.mockResolvedValueOnce({ data: [eligibleOrder({ id: 'order-1', public_id: 'ORD-1' })], error: null });
        mockRetryFetch.mockResolvedValueOnce({ data: [eligibleOrder({ id: 'order-9', public_id: 'ORD-9' })], error: null });
        mockFetchAndReleaseFunds
            .mockResolvedValueOnce({ success: true }) // phase 1 release
            .mockResolvedValueOnce({ success: true }); // phase 2 retry

        const report = await runAutoConfirm();

        expect(report.autoConfirmed).toBe(1);
        expect(report.released).toEqual(['ORD-1']);
        expect(report.retried).toBe(1);
        expect(report.retriedReleased).toEqual(['ORD-9']);
    });
});
