import { beforeEach, describe, expect, it, vi } from 'vitest';

const convex = await vi.hoisted(async () => {
    const { createConvexRouteMock } = await import('../helpers/convexRoute');
    return createConvexRouteMock();
});

const { mockDownloadLabelPdf, mockUploadLabelPdf } = vi.hoisted(() => ({
    mockDownloadLabelPdf: vi.fn(),
    mockUploadLabelPdf: vi.fn(),
}));

vi.mock('../../src/lib/core/auth', () => convex.authModule());
vi.mock('../../src/lib/shipping/sendcloud', () => ({
    downloadSendcloudLabelPdf: mockDownloadLabelPdf,
}));
vi.mock('../../src/lib/shipping/labelStorage', () => ({ uploadLabelPdf: mockUploadLabelPdf }));

const { GET } = await import('../../src/pages/api/sendcloud/label');

function call(shipmentId = '900001') {
    const request = new Request(`https://fewya.com/api/sendcloud/label?shipmentId=${shipmentId}`);
    return GET({ request } as never);
}

describe('GET /api/sendcloud/label', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        convex.reset();
    });

    it('redirects an authorized stored label to its resolved PDF URL', async () => {
        convex.query.mockResolvedValueOnce({
            labelUrl: 'convex-storage:label-fixture-id',
            resolvedLabelUrl: 'https://storage.example.test/label-fixture.pdf',
        });

        const response = await call();

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://storage.example.test/label-fixture.pdf');
        expect(mockDownloadLabelPdf).not.toHaveBeenCalled();
    });

    it('returns 404 instead of exposing a download when no label was persisted', async () => {
        convex.query.mockResolvedValueOnce({ labelUrl: null, resolvedLabelUrl: null });

        const response = await call();

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Label not found' });
        expect(mockDownloadLabelPdf).not.toHaveBeenCalled();
    });

    it('migrates an authorized legacy Sendcloud label into storage', async () => {
        convex.query.mockResolvedValueOnce({
            labelUrl: 'https://panel.sendcloud.sc/api/v2/parcels/900001/documents/label',
            resolvedLabelUrl: 'https://panel.sendcloud.sc/api/v2/parcels/900001/documents/label',
        });
        mockDownloadLabelPdf.mockResolvedValueOnce(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
        mockUploadLabelPdf.mockResolvedValueOnce({
            marker: 'convex-storage:migrated-label',
            url: 'https://storage.example.test/migrated-label.pdf',
        });

        const response = await call();

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://storage.example.test/migrated-label.pdf');
        expect(convex.mutation).toHaveBeenCalledWith(expect.anything(), {
            shipmentId: '900001',
            labelUrl: 'convex-storage:migrated-label',
        });
    });
});
