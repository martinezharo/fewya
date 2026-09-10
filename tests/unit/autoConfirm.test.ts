import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFunctionName } from 'convex/server';
import { api } from '../../convex/_generated/api';

const { mockQuery, mockMutation, mockReleaseAndRecordFunds } = vi.hoisted(() => ({
    mockQuery: vi.fn(),
    mockMutation: vi.fn(),
    mockReleaseAndRecordFunds: vi.fn(),
}));

vi.mock('../../src/lib/core/convex', () => ({
    createConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));

vi.mock('../../src/lib/payments/stripe', () => ({
    getStripeClient: () => ({}),
}));

vi.mock('../../src/lib/orders/convexPayout', () => ({
    releaseAndRecordFunds: mockReleaseAndRecordFunds,
}));

const { runAutoConfirm } = await import('../../src/lib/orders/autoConfirm');

const SECRET = 'cron-secret';

function candidate(publicId: string, overrides: Record<string, unknown> = {}) {
    return {
        orderId: `convex:${publicId}`,
        publicId,
        stripePaymentIntentId: 'pi_1',
        ...overrides,
    };
}

/** Serves the three reads the job performs, keyed by Convex function name. */
function stubReads({ eligible = [], retries = [] }: { eligible?: unknown[]; retries?: unknown[] } = {}) {
    mockQuery.mockImplementation(async (fn: any) => {
        const name = getFunctionName(fn);
        if (name === getFunctionName(api.orders.listAutoConfirmCandidates)) return eligible;
        if (name === getFunctionName(api.orders.listPendingFundReleaseCandidates)) return retries;
        if (name === getFunctionName(api.orders.getPayoutOrder)) {
            return { id: 'convex:ORD-1', publicId: 'ORD-1', stripePaymentIntentId: 'pi_1', items: [], labelCostByShop: {} };
        }
        throw new Error(`unexpected query: ${name}`);
    });
}

describe('runAutoConfirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stubReads();
        mockMutation.mockResolvedValue({ confirmed: true, orderId: 'convex:ORD-1', publicId: 'ORD-1' });
        mockReleaseAndRecordFunds.mockResolvedValue({ success: true });
    });

    it('does nothing without the deployment secret', async () => {
        const report = await runAutoConfirm();
        expect(report.autoConfirmed).toBe(0);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('reports an empty run when the candidate fetch fails, instead of throwing', async () => {
        mockQuery.mockRejectedValueOnce(new Error('convex down'));
        const report = await runAutoConfirm(SECRET);
        expect(report).toMatchObject({ autoConfirmed: 0, released: [], failed: [] });
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('confirms an eligible order and releases its funds on the happy path', async () => {
        stubReads({ eligible: [candidate('ORD-1')] });
        const report = await runAutoConfirm(SECRET);
        expect(report.autoConfirmed).toBe(1);
        expect(report.released).toEqual(['ORD-1']);
        expect(report.failed).toEqual([]);
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(1);
    });

    it('does not release funds for an order the confirm mutation refused', async () => {
        stubReads({ eligible: [candidate('ORD-1')] });
        mockMutation.mockResolvedValueOnce({ confirmed: false, orderId: 'convex:ORD-1', publicId: 'ORD-1' });
        const report = await runAutoConfirm(SECRET);
        expect(report.released).toEqual([]);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
    });

    it('marks an order as failed without releasing when it has no payment intent', async () => {
        stubReads({ eligible: [candidate('ORD-1', { stripePaymentIntentId: null })] });
        const report = await runAutoConfirm(SECRET);
        expect(report.failed).toEqual(['ORD-1']);
        expect(mockReleaseAndRecordFunds).not.toHaveBeenCalled();
        // The failure is still recorded on the order so it can be retried.
        expect(mockMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ orderId: 'convex:ORD-1', success: false }),
        );
    });

    it('records a failure when the fund release itself fails, without throwing', async () => {
        stubReads({ eligible: [candidate('ORD-1')] });
        mockReleaseAndRecordFunds.mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        const report = await runAutoConfirm(SECRET);
        expect(report.failed).toEqual(['ORD-1']);
        expect(report.released).toEqual([]);
    });

    it('handles a mix of successful and failed releases independently', async () => {
        stubReads({ eligible: [candidate('ORD-1'), candidate('ORD-2')] });
        mockReleaseAndRecordFunds
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: 'transfer failed' });
        const report = await runAutoConfirm(SECRET);
        expect(report.autoConfirmed).toBe(2);
        expect(report.released.length + report.failed.length).toBe(2);
    });

    it('recovers a previously-failed release on retry', async () => {
        stubReads({ retries: [candidate('ORD-9')] });
        const report = await runAutoConfirm(SECRET);
        expect(report.retried).toBe(1);
        expect(report.retriedReleased).toEqual(['ORD-9']);
    });

    it('keeps a retry order in retriedFailed when the release attempt fails again', async () => {
        stubReads({ retries: [candidate('ORD-9')] });
        mockReleaseAndRecordFunds.mockResolvedValueOnce({ success: false, error: 'still down' });
        const report = await runAutoConfirm(SECRET);
        expect(report.retriedFailed).toEqual(['ORD-9']);
    });

    it('runs the auto-confirm phase and the retry phase in the same invocation', async () => {
        stubReads({ eligible: [candidate('ORD-1')], retries: [candidate('ORD-9')] });
        const report = await runAutoConfirm(SECRET);
        expect(report.autoConfirmed).toBe(1);
        expect(report.retried).toBe(1);
        expect(mockReleaseAndRecordFunds).toHaveBeenCalledTimes(2);
    });
});
