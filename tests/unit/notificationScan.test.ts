import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_TYPE, ORDER_STATUS } from '../../src/lib/orders/orderStatus';
import { NOTIFICATION_TYPE } from '../../src/lib/notifications/types';

const createSupabaseAdminClient = vi.fn();
const notify = vi.fn();

vi.mock('../../src/lib/core/supabase-admin', () => ({ createSupabaseAdminClient }));
vi.mock('../../src/lib/notifications/dispatch', () => ({ notify }));

const { runNotificationScan } = await import('../../src/lib/notifications/scan');

type Result = { data: unknown[] | null; error: { message: string } | null };

function query(result: Result) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'ilike', 'gte', 'or', 'eq', 'lt', 'not']) {
        chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
}

function clientWith(results: Result[]) {
    const queries = results.map(query);
    const from = vi.fn(() => {
        const next = queries.shift();
        if (!next) throw new Error('Unexpected notification scan query');
        return next;
    });
    return { from };
}

const ok = (data: unknown[]): Result => ({ data, error: null });

describe('runNotificationScan', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-03T12:00:00Z')); // Monday
        notify.mockReset();
        notify.mockResolvedValue({ sent: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('deduplicates tracking hits and sends every reminder to the right party', async () => {
        const client = clientWith([
            ok([
                { shipments: { order_id: 'delivery-1', orders: { delivery_type: DELIVERY_TYPE.HOME } } },
                { shipments: { order_id: 'delivery-1', orders: [{ delivery_type: DELIVERY_TYPE.HOME }] } },
            ]),
            ok([
                { shipments: { order_id: 'pickup-1', orders: { delivery_type: DELIVERY_TYPE.PICKUP_POINT } } },
                { shipments: { order_id: 'home-1', orders: { delivery_type: DELIVERY_TYPE.HOME } } },
            ]),
            ok([
                {
                    order_id: 'pickup-reminder-1',
                    created_at: '2026-07-29T12:00:00Z',
                    orders: { status: ORDER_STATUS.SHIPPED, delivery_type: DELIVERY_TYPE.PICKUP_POINT },
                },
                {
                    order_id: 'delivered',
                    created_at: '2026-07-20T12:00:00Z',
                    orders: { status: ORDER_STATUS.DELIVERED, delivery_type: DELIVERY_TYPE.PICKUP_POINT },
                },
            ]),
            ok([{ id: 'label-1' }]),
            ok([
                { id: 'ship-1', paid_at: '2026-07-29T12:00:00Z' },
                { id: 'ship-too-new', paid_at: '2026-07-31T12:00:00Z' },
            ]),
        ]);
        createSupabaseAdminClient.mockReturnValue(client);

        await expect(runNotificationScan()).resolves.toEqual({
            outForDelivery: 1,
            pickupReady: 1,
            pickupReminder: 1,
            labelReminder: 1,
            shipReminder: 1,
        });

        expect(notify.mock.calls.map(([call]) => call)).toEqual(expect.arrayContaining([
            expect.objectContaining({ orderId: 'delivery-1', type: NOTIFICATION_TYPE.BUYER_OUT_FOR_DELIVERY, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'pickup-1', type: NOTIFICATION_TYPE.BUYER_PICKUP_READY, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'pickup-reminder-1', type: NOTIFICATION_TYPE.BUYER_PICKUP_REMINDER, recipient: 'buyer' }),
            expect.objectContaining({ orderId: 'label-1', type: NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, recipient: 'seller' }),
            expect.objectContaining({ orderId: 'ship-1', type: NOTIFICATION_TYPE.SELLER_SHIP_REMINDER, recipient: 'seller' }),
        ]));
        expect(notify).toHaveBeenCalledTimes(5);
    });

    it('isolates query and delivery failures so the cron still completes', async () => {
        const client = clientWith([
            { data: null, error: { message: 'tracking unavailable' } },
            ok([{ shipments: null }]),
            ok([]),
            ok([{ id: 'label-1' }, { id: 'label-2' }]),
            ok([]),
        ]);
        createSupabaseAdminClient.mockReturnValue(client);
        notify
            .mockRejectedValueOnce(new Error('provider down'))
            .mockResolvedValueOnce({ sent: true });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(runNotificationScan()).resolves.toEqual({
            outForDelivery: 0,
            pickupReady: 0,
            pickupReminder: 0,
            labelReminder: 1,
            shipReminder: 0,
        });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('notif_scan.out_for_delivery_failed'));
    });
});
