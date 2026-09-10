import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUploadConvexBytes } = vi.hoisted(() => ({ mockUploadConvexBytes: vi.fn() }));

vi.mock('../../src/lib/core/convexStorage', () => ({
    uploadConvexBytes: mockUploadConvexBytes,
}));

const { buildLabelPath, buildLabelUrlMarker, uploadLabelPdf, LABELS_BUCKET } =
    await import('../../src/lib/shipping/labelStorage');

describe('labelStorage path helpers', () => {
    it('buildLabelPath uses the public id as a flat file name', () => {
        expect(buildLabelPath('ORD-123-ABC')).toBe('ORD-123-ABC.pdf');
    });

    it('buildLabelUrlMarker prefixes the marker with the bucket name', () => {
        expect(buildLabelUrlMarker('ORD-123-ABC')).toBe('labels:ORD-123-ABC.pdf');
        expect(LABELS_BUCKET).toBe('labels');
    });
});

describe('uploadLabelPdf', () => {
    const request = new Request('https://fewya.com/api/sendcloud/shipment', { method: 'POST' });

    beforeEach(() => {
        mockUploadConvexBytes.mockReset();
    });

    it('stores the PDF in Convex Storage and returns its marker path', async () => {
        mockUploadConvexBytes.mockResolvedValueOnce({ path: 'convex-storage:abc123', url: 'https://files/abc123' });
        const pdfBytes = new Uint8Array([1, 2, 3]);

        const marker = await uploadLabelPdf('ORD-XYZ', pdfBytes, request);

        expect(marker).toBe('convex-storage:abc123');
        expect(mockUploadConvexBytes).toHaveBeenCalledWith(request, pdfBytes, 'application/pdf');
    });

    // The upload is authorized by the caller's session, so there is nothing to
    // upload with when the request is missing — fail instead of writing
    // unauthenticated.
    it('throws when called without the originating request', async () => {
        await expect(uploadLabelPdf('ORD-X', new Uint8Array())).rejects.toThrow(/request is required/i);
        expect(mockUploadConvexBytes).not.toHaveBeenCalled();
    });

    it('propagates an upload failure', async () => {
        mockUploadConvexBytes.mockRejectedValueOnce(new Error('boom'));
        await expect(uploadLabelPdf('ORD-X', new Uint8Array(), request)).rejects.toThrow(/boom/);
    });
});
