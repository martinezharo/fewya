import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetShipment, mockQuery, mockMutation } = vi.hoisted(() => ({
    mockGetShipment: vi.fn(),
    mockQuery: vi.fn(),
    mockMutation: vi.fn(),
}));

vi.mock('../../src/lib/shipping/sendcloud', () => ({
    getShipment: mockGetShipment,
}));

vi.mock('../../src/lib/core/convex', () => ({
    createConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));

const { syncAllTracking } = await import('../../src/lib/shipping/syncTracking');

const SECRET = 'cron-secret';

function makeShipments(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `shipment-${i}`,
        sendcloudShipmentId: `sc-${i}`,
        status: 'in_transit',
    }));
}

describe('syncAllTracking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMutation.mockResolvedValue({ ok: true });
    });

    it('does nothing without the deployment secret', async () => {
        const result = await syncAllTracking();
        expect(result).toEqual({ synced: 0, errors: 0 });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('caps in-flight Sendcloud calls at the concurrency limit while syncing every shipment', async () => {
        mockQuery.mockResolvedValue(makeShipments(12));

        let inFlight = 0;
        let maxInFlight = 0;

        mockGetShipment.mockImplementation(async (id: string) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10));
            inFlight--;
            return { status: 'delivered', trackingNumber: `TN-${id}`, trackingUrl: `https://track/${id}` };
        });

        const result = await syncAllTracking(SECRET);

        expect(mockGetShipment).toHaveBeenCalledTimes(12);
        expect(result).toEqual({ synced: 12, errors: 0 });
        expect(maxInFlight).toBeLessThanOrEqual(5);
        expect(maxInFlight).toBeGreaterThan(1); // sanity: batches do run concurrently, not one-by-one
    });

    it('tolerates individual shipment failures without failing the whole batch', async () => {
        mockQuery.mockResolvedValue(makeShipments(6));

        mockGetShipment.mockImplementation(async (id: string) => {
            if (id === 'sc-2' || id === 'sc-4') {
                throw new Error('Sendcloud unavailable');
            }
            return { status: 'delivered', trackingNumber: `TN-${id}`, trackingUrl: `https://track/${id}` };
        });

        const result = await syncAllTracking(SECRET);

        expect(mockGetShipment).toHaveBeenCalledTimes(6);
        expect(result).toEqual({ synced: 4, errors: 2 });
    });

    it('pushes the polled status into Convex for each shipment', async () => {
        mockQuery.mockResolvedValue(makeShipments(1));
        mockGetShipment.mockResolvedValue({ status: 'delivered', trackingNumber: 'TN-1', trackingUrl: 'https://track/1' });

        await syncAllTracking(SECRET);

        expect(mockMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                secret: SECRET,
                shipmentLegacyId: 'shipment-0',
                status: 'delivered',
                trackingNumber: 'TN-1',
            }),
        );
    });

    it('reports an error instead of throwing when the candidate fetch fails', async () => {
        mockQuery.mockRejectedValueOnce(new Error('convex down'));
        const result = await syncAllTracking(SECRET);
        expect(result).toEqual({ synced: 0, errors: 1 });
    });
});
