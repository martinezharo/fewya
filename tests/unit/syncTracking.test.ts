import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetShipment = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../src/lib/shipping/sendcloud', () => ({
    getShipment: mockGetShipment,
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        from: () => ({
            select: () => ({
                not: () => ({
                    not: () => Promise.resolve({ data: shipmentsFixture, error: null }),
                }),
            }),
        }),
        rpc: mockRpc,
    }),
}));

let shipmentsFixture: Array<{ id: string; sendcloud_shipment_id: string; status: string }> = [];

const { syncAllTracking } = await import('../../src/lib/shipping/syncTracking');

function makeShipments(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `shipment-${i}`,
        sendcloud_shipment_id: `sc-${i}`,
        status: 'in_transit',
    }));
}

describe('syncAllTracking concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRpc.mockResolvedValue({ error: null });
    });

    it('caps in-flight Sendcloud calls at the concurrency limit while syncing every shipment', async () => {
        shipmentsFixture = makeShipments(12);

        let inFlight = 0;
        let maxInFlight = 0;

        mockGetShipment.mockImplementation(async (id: string) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10));
            inFlight--;
            return { status: 'delivered', trackingNumber: `TN-${id}`, trackingUrl: `https://track/${id}` };
        });

        const result = await syncAllTracking();

        expect(mockGetShipment).toHaveBeenCalledTimes(12);
        expect(result).toEqual({ synced: 12, errors: 0 });
        expect(maxInFlight).toBeLessThanOrEqual(5);
        expect(maxInFlight).toBeGreaterThan(1); // sanity: batches do run concurrently, not one-by-one
    });

    it('tolerates individual shipment failures without failing the whole batch', async () => {
        shipmentsFixture = makeShipments(6);

        mockGetShipment.mockImplementation(async (id: string) => {
            if (id === 'sc-2' || id === 'sc-4') {
                throw new Error('Sendcloud unavailable');
            }
            return { status: 'delivered', trackingNumber: `TN-${id}`, trackingUrl: `https://track/${id}` };
        });

        const result = await syncAllTracking();

        expect(mockGetShipment).toHaveBeenCalledTimes(6);
        expect(result).toEqual({ synced: 4, errors: 2 });
    });
});
