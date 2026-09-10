import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_TYPE } from '../../src/lib/notifications/types';

const { mockQuery, notify } = vi.hoisted(() => ({
    mockQuery: vi.fn(),
    notify: vi.fn(),
}));

vi.mock('../../src/lib/core/convex', () => ({
    createConvexClient: () => ({ query: mockQuery, mutation: vi.fn() }),
}));
vi.mock('../../src/lib/notifications/dispatch', () => ({ notify }));

const { runNotificationScan } = await import('../../src/lib/notifications/scan');

const SECRET = 'cron-secret';
/** Monday, so the working-day thresholds are unambiguous. */
const NOW = new Date('2026-08-03T12:00:00Z');
const days = (n: number) => NOW.getTime() - n * 86_400_000;

function candidates(overrides: Record<string, unknown> = {}) {
    return {
        outForDelivery: [],
        pickupReady: [],
        pickupReminder: [],
        labelReminder: [],
        shipReminder: [],
        ...overrides,
    };
}

describe('runNotificationScan', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.clearAllMocks();
        notify.mockResolvedValue({ sent: true });
        mockQuery.mockResolvedValue(candidates());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does nothing without the deployment secret', async () => {
        await expect(runNotificationScan()).resolves.toEqual({
            outForDelivery: 0, pickupReady: 0, pickupReminder: 0, labelReminder: 0, shipReminder: 0,
        });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('sends every reminder to the right party', async () => {
        mockQuery.mockResolvedValueOnce(candidates({
            outForDelivery: ['convex:delivery-1'],
            pickupReady: ['convex:pickup-1'],
            // Waiting at the pickup point since last Wednesday: past the threshold.
            pickupReminder: [{ orderId: 'convex:pickup-reminder-1', createdAt: days(5) }],
            labelReminder: ['convex:label-1'],
            shipReminder: [{ orderId: 'convex:ship-1', paidAt: days(5) }],
        }));

        await expect(runNotificationScan(SECRET)).resolves.toEqual({
            outForDelivery: 1,
            pickupReady: 1,
            pickupReminder: 1,
            labelReminder: 1,
            shipReminder: 1,
        });

        expect(notify.mock.calls.map(([call]) => call)).toEqual(expect.arrayContaining([
            expect.objectContaining({ orderId: 'convex:delivery-1', type: NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'convex:pickup-1', type: NOTIFICATION_TYPE.BUYER_PICKUP_READY, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'convex:pickup-reminder-1', type: NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'convex:label-1', type: NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, recipient: 'seller' }),
            expect.objectContaining({ orderId: 'convex:ship-1', type: NOTIFICATION_TYPE.SELLER_SHIP_REMINDER, recipient: 'seller' }),
        ]));
        expect(notify).toHaveBeenCalledTimes(5);
    });

    it('holds back reminders whose working-day threshold has not elapsed', async () => {
        mockQuery.mockResolvedValueOnce(candidates({
            // Yesterday: one working day, below the three-day threshold.
            pickupReminder: [{ orderId: 'convex:pickup-too-new', createdAt: days(1) }],
            shipReminder: [{ orderId: 'convex:ship-too-new', paidAt: days(1) }],
        }));

        await expect(runNotificationScan(SECRET)).resolves.toMatchObject({
            pickupReminder: 0,
            shipReminder: 0,
        });
        expect(notify).not.toHaveBeenCalled();
    });

    it('isolates delivery failures so the cron still completes', async () => {
        mockQuery.mockResolvedValueOnce(candidates({ labelReminder: ['convex:label-1', 'convex:label-2'] }));
        notify
            .mockRejectedValueOnce(new Error('provider down'))
            .mockResolvedValueOnce({ sent: true });

        await expect(runNotificationScan(SECRET)).resolves.toMatchObject({ labelReminder: 1 });
    });

    it('reports an empty run when the candidate query fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockQuery.mockRejectedValueOnce(new Error('convex down'));

        await expect(runNotificationScan(SECRET)).resolves.toEqual({
            outForDelivery: 0, pickupReady: 0, pickupReminder: 0, labelReminder: 0, shipReminder: 0,
        });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('notif_scan.fetch_failed'));
    });
});
