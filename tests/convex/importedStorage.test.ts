/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import { newTestHarness, seedBuyer, seedOrder, seedTenant, identity } from './fixtures';

/**
 * Imported references are not all the same shape.
 *
 * Supabase was used two ways: product and shop images were stored as the
 * public object URL, while shipping labels — never public — were stored as
 * `bucket:path`, the string the importer also used as the object's `legacyId`.
 * Only the URL form resolved, so every imported label 404'd for the buyer and
 * the seller of a delivered order.
 */
describe('imported storage references', () => {
    const BUYER = 'imported-buyer';
    const SELLER = 'imported-seller';

    async function seedImportedLabel(t: ReturnType<typeof newTestHarness>) {
        const seller = await seedTenant(t, 'imported-seller', SELLER);
        const buyer = await seedBuyer(t, 'imported-buyer', BUYER);
        const order = await seedOrder(t, 'imported-order', buyer, seller);

        return await t.run(async (ctx) => {
            const storageId = await ctx.storage.store(new Blob(['label pdf']));
            const reference = 'labels:ORD-1787223505146-18E3EB08.pdf';
            await ctx.db.insert('storageObjects', {
                legacyId: reference,
                bucket: 'labels',
                legacyPath: 'ORD-1787223505146-18E3EB08.pdf',
                storageId,
                bytes: 9,
                sha256: 'sha',
                visibility: 'private',
                createdAt: 1,
            });
            await ctx.db.insert('shipments', {
                legacyId: 'shipment-imported',
                orderId: order.orderId,
                orderLegacyId: order.orderLegacyId,
                sendcloudShipmentId: 'sc-imported',
                status: 'delivered',
                labelUrl: reference,
                createdAt: 1,
                updatedAt: 1,
            });
            return { reference, storageId };
        });
    }

    it('resolves a bucket:path label for the order parties', async () => {
        const t = newTestHarness();
        const { reference } = await seedImportedLabel(t);

        for (const subject of [BUYER, SELLER]) {
            const caller = t.withIdentity(identity(subject, `${subject}@fewya.test`));
            const shipment = await caller.query(api.orders.getShipmentForAccess, { shipmentId: 'sc-imported' });
            expect(shipment?.labelUrl).toBe(reference);
            // Resolved means resolved: handing the reference straight back is
            // what sent the label route down the Sendcloud fallback, which
            // cannot fetch a `bucket:path` string.
            expect(shipment?.resolvedLabelUrl).toBeTruthy();
            expect(shipment?.resolvedLabelUrl).not.toBe(reference);
        }
    });

    it('still refuses the label to someone outside the order', async () => {
        const t = newTestHarness();
        await seedImportedLabel(t);
        await seedBuyer(t, 'imported-stranger', 'imported-stranger');

        const stranger = t.withIdentity(identity('imported-stranger', 'imported-stranger@fewya.test'));
        await expect(
            stranger.query(api.orders.getShipmentForAccess, { shipmentId: 'sc-imported' }),
        ).rejects.toThrow();
    });

    // A provider's own document link is not an imported reference and must
    // come back untouched, so the route can still fall back to Sendcloud.
    it('hands back a reference that matches no imported object', async () => {
        const t = newTestHarness();
        const seller = await seedTenant(t, 'imported-seller', SELLER);
        const buyer = await seedBuyer(t, 'imported-buyer', BUYER);
        const order = await seedOrder(t, 'imported-order', buyer, seller);
        const providerUrl = 'https://panel.sendcloud.sc/api/v2/labels/label_printer/123';
        await t.run(async (ctx) => {
            await ctx.db.insert('shipments', {
                legacyId: 'shipment-provider',
                orderId: order.orderId,
                orderLegacyId: order.orderLegacyId,
                sendcloudShipmentId: 'sc-provider',
                status: 'shipped',
                labelUrl: providerUrl,
                createdAt: 1,
                updatedAt: 1,
            });
        });

        const caller = t.withIdentity(identity(BUYER, `${BUYER}@fewya.test`));
        const shipment = await caller.query(api.orders.getShipmentForAccess, { shipmentId: 'sc-provider' });
        expect(shipment?.resolvedLabelUrl).toBe(providerUrl);
    });
});
