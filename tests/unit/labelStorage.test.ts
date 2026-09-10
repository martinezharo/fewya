import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUploadConvexBytes } = vi.hoisted(() => ({ mockUploadConvexBytes: vi.fn() }));

vi.mock('../../src/lib/core/convexStorage', () => ({
    uploadConvexBytes: mockUploadConvexBytes,
}));

const { uploadLabelPdf } = await import('../../src/lib/shipping/labelStorage');

describe('uploadLabelPdf', () => {
    const request = new Request('https://fewya.com/api/sendcloud/shipment', { method: 'POST' });

    beforeEach(() => {
        mockUploadConvexBytes.mockReset();
    });

    it('stores the PDF in Convex Storage and returns its marker path', async () => {
        mockUploadConvexBytes.mockResolvedValueOnce({ path: 'convex-storage:abc123', url: 'https://files/abc123' });
        const pdfBytes = new Uint8Array([1, 2, 3]);

        const marker = await uploadLabelPdf(pdfBytes, request);

        expect(marker).toBe('convex-storage:abc123');
        expect(mockUploadConvexBytes).toHaveBeenCalledWith(request, pdfBytes, 'application/pdf');
    });

    // The upload is authorized by the caller's session, so an unauthenticated
    // request must fail rather than write a label nobody owns.
    it('propagates an upload failure', async () => {
        mockUploadConvexBytes.mockRejectedValueOnce(new Error('Convex authentication is required for uploads'));
        await expect(uploadLabelPdf(new Uint8Array(), request)).rejects.toThrow(/authentication is required/i);
    });
});
