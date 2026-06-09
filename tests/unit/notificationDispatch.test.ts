import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmailMock = vi.fn();
const sendPushMock = vi.fn();

vi.mock('../../src/lib/notifications/resend', () => ({
    sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock('../../src/lib/notifications/push', () => ({
    sendPush: (...args: unknown[]) => sendPushMock(...args),
}));

import { notify } from '../../src/lib/notifications/dispatch';
import { NOTIFICATION_TYPE } from '../../src/lib/notifications/types';

const ORDER_ROW = {
    id: 'o1',
    public_id: 'ORD-1',
    buyer_id: 'buyer-1',
    buyer_email: 'buyer@example.com',
    pickup_point_name: null,
    shops: { name: 'Tienda', owner_id: 'seller-1', contact_email: null, owner: { email: 'seller@example.com' } },
    shipments: [{ tracking_url: null }],
};

/**
 * Stateful fake of the admin client. The notification_log upsert mimics
 * INSERT ... ON CONFLICT DO NOTHING: it returns the claimed row only the first
 * time a given (order_id, type) is seen, and an empty array afterwards.
 */
function makeFakeClient() {
    const claimed = new Set<string>();
    return {
        from(table: string) {
            if (table === 'orders') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () => Promise.resolve({ data: ORDER_ROW, error: null }),
                        }),
                    }),
                };
            }
            if (table === 'notification_log') {
                return {
                    upsert: (row: { order_id: string; type: string }) => ({
                        select: () => {
                            const key = `${row.order_id}:${row.type}`;
                            if (claimed.has(key)) return Promise.resolve({ data: [], error: null });
                            claimed.add(key);
                            return Promise.resolve({ data: [{ id: `log-${key}` }], error: null });
                        },
                    }),
                    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
                };
            }
            if (table === 'push_subscriptions') {
                return {
                    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
                    delete: () => ({ in: () => Promise.resolve({ data: null, error: null }) }),
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };
}

describe('notify (dispatch)', () => {
    beforeEach(() => {
        sendEmailMock.mockReset();
        sendPushMock.mockReset();
        sendEmailMock.mockResolvedValue({ sent: true });
        sendPushMock.mockResolvedValue({ sent: true });
    });

    it('envía la primera vez y deduplica las siguientes para el mismo (pedido, tipo)', async () => {
        const client = makeFakeClient() as never;

        const first = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'o1',
            recipient: 'seller',
            client,
        });
        expect(first.sent).toBe(true);
        expect(sendEmailMock).toHaveBeenCalledTimes(1);

        const second = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'o1',
            recipient: 'seller',
            client,
        });
        expect(second.sent).toBe(false);
        expect(second.skipped).toBe(true);
        expect(second.reason).toBe('already_sent');
        // No second email — dedupe prevented the resend.
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });

    it('envía el email al comprador para una notificación de comprador', async () => {
        const client = makeFakeClient() as never;
        await notify({
            type: NOTIFICATION_TYPE.BUYER_READY_TO_SEND,
            orderId: 'o1',
            recipient: 'buyer',
            client,
        });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'buyer@example.com' });
    });

    it('devuelve skipped cuando el pedido no existe', async () => {
        const client = {
            from: () => ({
                select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
            }),
        } as never;
        const result = await notify({
            type: NOTIFICATION_TYPE.SELLER_NEW_SALE,
            orderId: 'missing',
            recipient: 'seller',
            client,
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('order_not_found');
        expect(sendEmailMock).not.toHaveBeenCalled();
    });
});
