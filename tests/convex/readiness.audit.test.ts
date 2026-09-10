/**
 * @vitest-environment edge-runtime
 */
import { afterEach, describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import { newTestHarness, seedTenant, seedBuyer, seedOrder, identity } from './fixtures';

/**
 * Regressions found auditing the Convex cutover against production data.
 *
 * Each one passed the authorization suite and still broke something real: a
 * private file readable by any account, a payout that could be marked done
 * before the money moved, a form field that could not be emptied, and imported
 * orders locked out of operations their owners are entitled to. They are kept
 * together because they share a cause — rules written for orders created after
 * the cutover, applied to a database that also holds everything before it.
 */

const SECRET = 'audit-webhook-secret';

const buyerIdentity = identity('audit-buyer', 'audit-buyer@fewya.test');

afterEach(() => {
    delete process.env.CONVEX_WEBHOOK_SECRET;
});

describe('optional profile fields', () => {
    it('clears an optional profile field without violating the schema', async () => {
        const t = newTestHarness();
        await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const caller = t.withIdentity(buyerIdentity);

        await caller.mutation(api.users.updateCurrent, { addressFloor: '3B' });
        await expect(
            caller.mutation(api.users.updateCurrent, { addressFloor: null }),
        ).resolves.toBeDefined();

        const profile = await caller.query(api.users.current, {});
        expect(profile?.addressFloor).toBeUndefined();
    });

    // A blank submission is the same intent as null: the address form posts
    // every field it owns on every save.
    it('treats a blank submission as clearing the field', async () => {
        const t = newTestHarness();
        await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const caller = t.withIdentity(buyerIdentity);

        await caller.mutation(api.users.updateCurrent, { addressFloor: '3B' });
        await caller.mutation(api.users.updateCurrent, { addressFloor: '   ' });

        expect((await caller.query(api.users.current, {}))?.addressFloor).toBeUndefined();
    });

    it('leaves a field alone when it is not submitted', async () => {
        const t = newTestHarness();
        await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const caller = t.withIdentity(buyerIdentity);

        await caller.mutation(api.users.updateCurrent, { addressFloor: '3B' });
        await caller.mutation(api.users.updateCurrent, { addressCity: 'Madrid' });

        expect((await caller.query(api.users.current, {}))?.addressFloor).toBe('3B');
    });
});

describe('imported orders', () => {
    /** Turns a seeded order into one the importer would have created. */
    async function importOrder(t: ReturnType<typeof newTestHarness>, orderId: any) {
        await t.run(async (ctx) => {
            await ctx.db.patch(orderId, { legacyId: 'legacy-supabase-order' });
        });
        return 'legacy-supabase-order';
    }

    it('keeps hiding an imported unpaid checkout available to its buyer', async () => {
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller, { status: 'pending', paymentStatus: 'pending' });
        const legacyId = await importOrder(t, order.orderId);

        await expect(
            t.withIdentity(buyerIdentity).mutation(api.orders.hideForCurrentBuyer, { orderId: legacyId }),
        ).resolves.toBeDefined();
    });

    it('still refuses an imported order to a stranger', async () => {
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        await seedBuyer(t, 'audit-stranger', 'audit-stranger');
        const order = await seedOrder(t, 'audit-order', buyer, seller, { status: 'pending', paymentStatus: 'pending' });
        const legacyId = await importOrder(t, order.orderId);

        const stranger = t.withIdentity(identity('audit-stranger', 'audit-stranger@fewya.test'));
        await expect(stranger.mutation(api.orders.hideForCurrentBuyer, { orderId: legacyId })).rejects.toThrow();
    });

    // The other half of the rule: an imported order was paid, settled and paid
    // out in the old stack, so Convex must not run any of that again.
    it('refuses to confirm delivery on an imported order', async () => {
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);
        const legacyId = await importOrder(t, order.orderId);

        await expect(
            t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, { orderId: legacyId }),
        ).rejects.toThrow(/imported/i);
    });
});

describe('fund release ordering', () => {
    it('does not mark funds released without a Stripe transfer', async () => {
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);

        await t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, {
            orderId: order.orderLegacyId,
        });

        const row = await t.run(async (ctx) => ctx.db.get(order.orderId));
        expect(row?.status).toBe('confirmed');
        expect(row?.fundsReleasedAt).toBeUndefined();
        expect(row?.fundsReleaseRequestedAt).toBeTypeOf('number');
    });

    // Calling the mutation directly is the case that used to strand the money:
    // the order left the delivered-order scan without ever being paid out, and
    // nothing marked it failed either.
    it('leaves a directly confirmed order visible to the retry scan', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);

        await t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, {
            orderId: order.orderLegacyId,
        });

        const pending = await t.query(api.orders.listPendingFundReleaseCandidates, { secret: SECRET });
        expect(pending.map((candidate) => candidate.orderId)).toContain(order.orderLegacyId);
    });

    it('drops the order from the retry scan once the transfer is recorded', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);

        await t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, {
            orderId: order.orderLegacyId,
        });
        await t.mutation(api.orders.recordFundsRelease, {
            secret: SECRET,
            orderId: order.orderLegacyId,
            success: true,
        });

        const row = await t.run(async (ctx) => ctx.db.get(order.orderId));
        expect(row?.fundsReleasedAt).toBeTypeOf('number');
        expect(row?.fundsReleaseStatus).toBe('released');

        const pending = await t.query(api.orders.listPendingFundReleaseCandidates, { secret: SECRET });
        expect(pending.map((candidate) => candidate.orderId)).not.toContain(order.orderLegacyId);
    });

    // A release that is still in flight is left alone; only Stripe's
    // idempotency key stands between a duplicated sweep and a double transfer.
    it('holds a just-confirmed order back for the grace period', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);

        await t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, {
            orderId: order.orderLegacyId,
        });

        const pending = await t.query(api.orders.listPendingFundReleaseCandidates, {
            secret: SECRET,
            grace: 10 * 60 * 1000,
        });
        expect(pending).toHaveLength(0);
    });

    it('sweeps a recorded failure immediately, whatever the grace period', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller);

        await t.withIdentity(buyerIdentity).mutation(api.orders.confirmDeliveryForBuyer, {
            orderId: order.orderLegacyId,
        });
        await t.mutation(api.orders.recordFundsRelease, {
            secret: SECRET,
            orderId: order.orderLegacyId,
            success: false,
            error: 'account_disabled',
        });

        const pending = await t.query(api.orders.listPendingFundReleaseCandidates, {
            secret: SECRET,
            grace: 10 * 60 * 1000,
        });
        expect(pending.map((candidate) => candidate.orderId)).toContain(order.orderLegacyId);
    });
});

describe('private storage objects', () => {
    it('refuses another signed-in user access to a private storage file', async () => {
        const t = newTestHarness();
        await seedBuyer(t, 'audit-stranger', 'unrelated-buyer');
        const file = await t.run(async (ctx) => ctx.storage.store(new Blob(['private shipping label'])));
        const caller = t.withIdentity(identity('unrelated-buyer', 'audit-stranger@fewya.test'));

        await expect(caller.query(api.storage.getUrl, { storageId: file })).rejects.toThrow();
    });

    it('resolves a file for the account that uploaded it', async () => {
        const t = newTestHarness();
        await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const caller = t.withIdentity(buyerIdentity);
        const file = await t.run(async (ctx) => ctx.storage.store(new Blob(['own upload'])));

        const claimed = await caller.mutation(api.storage.claimUpload, { storageId: file });
        expect(claimed.url).toBeTruthy();
        expect(await caller.query(api.storage.getUrl, { storageId: file })).toBeTruthy();
    });
});

describe('payments on imported checkouts', () => {
    // The cutover left one Stripe session open against an imported order.
    // Paying it cannot be fulfilled here, and quietly acknowledging the event
    // would keep the buyer's money with nothing shipped.
    it('asks for a refund instead of silently acknowledging the payment', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();
        const seller = await seedTenant(t, 'audit-seller', 'audit-seller');
        const buyer = await seedBuyer(t, 'audit-buyer', 'audit-buyer');
        const order = await seedOrder(t, 'audit-order', buyer, seller, {
            status: 'pending',
            paymentStatus: 'pending',
            stripeCheckoutSessionId: 'cs_imported_open',
        });
        await t.run(async (ctx) => {
            await ctx.db.patch(order.orderId, { legacyId: 'legacy-supabase-order' });
        });

        const result = await t.mutation(api.orders.processStripePayment, {
            secret: SECRET,
            eventId: 'evt_imported_open',
            sessionId: 'cs_imported_open',
        });

        expect(result).toMatchObject({ handled: true, requiresRefund: true, failureReason: 'imported_order_not_payable' });

        // The imported order is left exactly as the old stack has it.
        const row = await t.run(async (ctx) => ctx.db.get(order.orderId));
        expect(row?.paymentStatus).toBe('pending');
        expect(row?.status).toBe('pending');
    });

    it('still ignores an event that matches no order at all', async () => {
        process.env.CONVEX_WEBHOOK_SECRET = SECRET;
        const t = newTestHarness();

        const result = await t.mutation(api.orders.processStripePayment, {
            secret: SECRET,
            eventId: 'evt_unknown',
            sessionId: 'cs_unknown',
        });

        expect(result).toMatchObject({ handled: false, requiresRefund: false });
    });
});
