import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpload = vi.fn();

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        storage: {
            from: (_bucket: string) => ({
                upload: mockUpload,
            }),
        },
    }),
}));

const { buildLabelPath, buildLabelUrlMarker, uploadLabelPdf, LABELS_BUCKET } =
    await import('../../src/lib/shipping/labelStorage');

describe('labelStorage path helpers', () => {
    it('buildLabelPath usa el public_id como nombre del archivo plano', () => {
        expect(buildLabelPath('ORD-123-ABC')).toBe('ORD-123-ABC.pdf');
    });

    it('buildLabelUrlMarker prefija con el bucket', () => {
        expect(buildLabelUrlMarker('ORD-123-ABC')).toBe('labels:ORD-123-ABC.pdf');
        expect(LABELS_BUCKET).toBe('labels');
    });
});

describe('uploadLabelPdf', () => {
    beforeEach(() => {
        mockUpload.mockReset();
    });

    it('sube al bucket labels con upsert: true y nombre = <public_id>.pdf', async () => {
        mockUpload.mockResolvedValueOnce({ error: null });
        const pdfBytes = new Uint8Array([1, 2, 3]);

        const marker = await uploadLabelPdf('ORD-XYZ', pdfBytes);

        expect(marker).toBe('labels:ORD-XYZ.pdf');
        expect(mockUpload).toHaveBeenCalledTimes(1);
        const [path, bytes, opts] = mockUpload.mock.calls[0];
        expect(path).toBe('ORD-XYZ.pdf');
        expect(bytes).toBe(pdfBytes);
        expect(opts).toEqual({ contentType: 'application/pdf', upsert: true });
    });

    it('lanza si el upload falla', async () => {
        mockUpload.mockResolvedValueOnce({ error: { message: 'boom' } });

        await expect(uploadLabelPdf('ORD-X', new Uint8Array())).rejects.toThrow(/boom/);
    });
});
