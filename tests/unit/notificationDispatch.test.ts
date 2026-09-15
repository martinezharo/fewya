import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFunctionName } from 'convex/server';
import { api } from '../../convex/_generated/api';

const { sendEmailMock, sendPushMock, mockQuery, mockMutation } = vi.hoisted(() => ({
    sendEmailMock: vi.fn(),
    sendPushMock: vi.fn(),
    mockQuery: vi.fn(),
    mockMutation: vi.fn(),
}));

vi.mock('../../src/lib/notifications/resend', () => ({
    sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock('../../src/lib/notifications/push', () => ({
    sendPush: (...args: unknown[]) => sendPushMock(...args),
}));
vi.mock('../../src/lib/core/convex', () => ({
    createConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));

const { notify } = await import('../../src/lib/notifications/dispatch');
const { NOTIFICATION_TYPE } = await import('../../src/lib/notifications/types');

const SECRET = 'convex-webhook-mock';

function claimed(overrides: Record<string, unknown> = {}) {
    return {
        claimed: true,
        notificationId: 'notif-1',
        orderPublicId: 'ORD-1',
        shopName: 'Tienda',
        trackingUrl: null,
        pickupPointName: null,
        recipientEmail: 'seller@example.com',
        recipientUserLegacyId: 'seller-1',
        ...overrides,
    };
}

/**
 * Claiming is what makes a notification idempotent: Convex hands out the
 * notification row once, and every later attempt for the same (order, type)
 * comes back unclaimed.
 */
function claimOnce() {
    const seen = new Set<string>();
    mockMutation.mockImplementation(async (fn: any, args: any) => {
        if (getFunctionName(fn) !== getFunctionName(api.orders.claimNotification)) return { ok: true };
        const key = `${args.orderId}:${args.type}`;
        if (seen.has(key)) return { claimed: false, reason: 'already_sent' };
        seen.add(key);
        return claimed();
    });
}

describe('notify (dispatch)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sendEmailMock.mockResolvedValue({ sent: true });
        sendPushMock.mockResolvedValue({ sent: true });
        mockQuery.mockResolvedValue([]);
        claimOnce();
    });

    it('sends the first time and deduplicates later attempts for the same (order, type)', async () => {
        const first = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'convex:ORD-1',
            recipient: 'seller',
            convexSecret: SECRET,
        });
        expect(first.sent).toBe(true);
        expect(sendEmailMock).toHaveBeenCalledTimes(1);

        const second = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'convex:ORD-1',
            recipient: 'seller',
            convexSecret: SECRET,
        });
        expect(second.sent).toBe(false);
        expect(second.skipped).toBe(true);
        expect(second.reason).toBe('already_sent');
        // No second email — the claim prevented the resend.
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });

    it('emails the address Convex resolved for the recipient', async () => {
        mockMutation.mockResolvedValueOnce(claimed({ recipientEmail: 'buyer@example.com' }));
        await notify({
            type: NOTIFICATION_TYPE.BUYER_READY_TO_SEND,
            orderId: 'convex:ORD-1',
            recipient: 'buyer',
            convexSecret: SECRET,
        });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'buyer@example.com' });
    });

    it('does not pass a placeholder recipient to Resend', async () => {
        mockMutation.mockResolvedValueOnce(claimed({
            recipientEmail: 'clerk-buyer-without-email@invalid.local',
            recipientUserLegacyId: null,
        }));
        const result = await notify({
            type: NOTIFICATION_TYPE.BUYER_READY_TO_SEND,
            orderId: 'convex:ORD-1',
            recipient: 'buyer',
            convexSecret: SECRET,
        });

        expect(sendEmailMock).not.toHaveBeenCalled();
        expect(result.emailStatus).toBe('no_recipient');
    });

    it('returns skipped when the order cannot be claimed', async () => {
        mockMutation.mockResolvedValueOnce({ claimed: false, reason: 'order_not_found' });
        const result = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'convex:missing',
            recipient: 'seller',
            convexSecret: SECRET,
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('order_not_found');
        expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('pushes to every stored subscription and drops the ones that are gone', async () => {
        mockQuery.mockResolvedValueOnce([
            { legacyId: 'sub-1', endpoint: 'https://push/1', p256dh: 'k1', auth: 'a1' },
            { legacyId: 'sub-2', endpoint: 'https://push/2', p256dh: 'k2', auth: 'a2' },
        ]);
        sendPushMock
            .mockResolvedValueOnce({ sent: true })
            .mockResolvedValueOnce({ sent: false, gone: true });

        const result = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'convex:ORD-1',
            recipient: 'seller',
            convexSecret: SECRET,
        });

        expect(result.pushStatus).toBe('sent:1/2');
        expect(mockMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ subscriptionLegacyId: 'sub-2' }),
        );
    });

    it('records the delivery outcome on the claimed notification', async () => {
        await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'convex:ORD-1',
            recipient: 'seller',
            convexSecret: SECRET,
        });
        expect(mockMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ notificationId: 'notif-1', emailStatus: 'sent' }),
        );
    });
});
