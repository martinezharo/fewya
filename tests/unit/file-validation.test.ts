import { describe, it, expect } from 'vitest';
import { detectImageMimeType } from '../../src/lib/core/file-validation';

function makeFile(bytes: number[], name = 'test.bin', type = 'application/octet-stream'): File {
    const uint = new Uint8Array(bytes.concat(new Array(20).fill(0)));
    return new File([uint], name, { type });
}

const JPEG_MAGIC = [0xFF, 0xD8, 0xFF, 0xE0];
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const HTML_MAGIC = [0x3C, 0x68, 0x74, 0x6D, 0x6C]; // <html

describe('detectImageMimeType', () => {
    it('detects JPEG by magic bytes', async () => {
        const file = makeFile(JPEG_MAGIC, 'photo.jpg', 'image/jpeg');
        expect(await detectImageMimeType(file)).toBe('image/jpeg');
    });

    it('detects PNG by magic bytes', async () => {
        const file = makeFile(PNG_MAGIC, 'img.png', 'image/png');
        expect(await detectImageMimeType(file)).toBe('image/png');
    });

    it('detects WebP by magic bytes', async () => {
        const file = makeFile(WEBP_MAGIC, 'img.webp', 'image/webp');
        expect(await detectImageMimeType(file)).toBe('image/webp');
    });

    it('detects GIF by magic bytes', async () => {
        const file = makeFile(GIF_MAGIC, 'anim.gif', 'image/gif');
        expect(await detectImageMimeType(file)).toBe('image/gif');
    });

    it('rejects HTML disguised as PNG (Content-Type spoofing)', async () => {
        const file = makeFile(HTML_MAGIC, 'evil.png', 'image/png');
        expect(await detectImageMimeType(file)).toBeNull();
    });

    it('rejects empty/zero bytes', async () => {
        const file = makeFile([0x00, 0x00, 0x00, 0x00]);
        expect(await detectImageMimeType(file)).toBeNull();
    });

    it('returns null for unknown format', async () => {
        const file = makeFile([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(await detectImageMimeType(file)).toBeNull();
    });
});
