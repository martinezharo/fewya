import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    planDraw,
    renameToWebp,
    isAnimatedGif,
    compressImage,
    AVATAR_PRESET,
    PRODUCT_PRESET,
} from '../../src/lib/ui/imageCompress';

describe('planDraw — cover mode', () => {
    it('center-crops a wide image to a square target', () => {
        const plan = planDraw(1000, 500, 320, 320, 'cover');
        expect(plan.canvasW).toBe(320);
        expect(plan.canvasH).toBe(320);
        // square crop from a 1000x500 source = 500x500 centered
        expect(plan.srcW).toBe(500);
        expect(plan.srcH).toBe(500);
        expect(plan.srcX).toBe(250);
        expect(plan.srcY).toBe(0);
    });

    it('center-crops a tall image to a square target', () => {
        const plan = planDraw(400, 1000, 320, 320, 'cover');
        expect(plan.canvasW).toBe(320);
        expect(plan.canvasH).toBe(320);
        expect(plan.srcW).toBe(400);
        expect(plan.srcH).toBe(400);
        expect(plan.srcX).toBe(0);
        expect(plan.srcY).toBe(300);
    });

    it('does not upscale when source is smaller than target', () => {
        const plan = planDraw(200, 200, 320, 320, 'cover');
        expect(plan.canvasW).toBe(200);
        expect(plan.canvasH).toBe(200);
        expect(plan.dstW).toBe(200);
        expect(plan.dstH).toBe(200);
    });
});

describe('planDraw — contain mode', () => {
    it('downscales preserving aspect ratio', () => {
        const plan = planDraw(3200, 2400, 1600, 1600, 'contain');
        expect(plan.canvasW).toBe(1600);
        expect(plan.canvasH).toBe(1200);
        expect(plan.srcX).toBe(0);
        expect(plan.srcY).toBe(0);
        expect(plan.srcW).toBe(3200);
        expect(plan.srcH).toBe(2400);
    });

    it('does not upscale smaller images', () => {
        const plan = planDraw(800, 600, 1600, 1600, 'contain');
        expect(plan.canvasW).toBe(800);
        expect(plan.canvasH).toBe(600);
    });

    it('respects the smaller of width/height bound for wide banners', () => {
        const plan = planDraw(4000, 1500, 2000, 800, 'contain');
        // scale = min(2000/4000, 800/1500) = min(0.5, 0.533) = 0.5
        expect(plan.canvasW).toBe(2000);
        expect(plan.canvasH).toBe(750);
    });
});

describe('renameToWebp', () => {
    it('replaces the extension', () => {
        expect(renameToWebp('photo.jpg')).toBe('photo.webp');
        expect(renameToWebp('IMG_1234.PNG')).toBe('IMG_1234.webp');
    });

    it('appends .webp when there is no extension', () => {
        expect(renameToWebp('photo')).toBe('photo.webp');
    });

    it('handles names that begin with a dot', () => {
        expect(renameToWebp('.hidden')).toBe('.hidden.webp');
    });
});

describe('isAnimatedGif', () => {
    it('returns false for non-GIF bytes', () => {
        expect(isAnimatedGif(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]))).toBe(false);
    });

    it('returns false for a static GIF (single GCE)', () => {
        const bytes = new Uint8Array(64);
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
        bytes.set([0x21, 0xF9], 20); // one GCE only
        expect(isAnimatedGif(bytes)).toBe(false);
    });

    it('returns true for a GIF with multiple GCE blocks', () => {
        const bytes = new Uint8Array(128);
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
        bytes.set([0x21, 0xF9], 20);
        bytes.set([0x21, 0xF9], 60);
        expect(isAnimatedGif(bytes)).toBe(true);
    });
});

describe('compressImage — fallbacks', () => {
    const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;

    afterEach(() => {
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap;
    });

    it('returns the original file when createImageBitmap is unavailable', async () => {
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
        const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
        const result = await compressImage(file, PRODUCT_PRESET);
        expect(result).toBe(file);
    });

    it('returns the original file when bitmap decoding fails', async () => {
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => {
            throw new Error('decode failure');
        });
        const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
        const result = await compressImage(file, AVATAR_PRESET);
        expect(result).toBe(file);
    });

    it('passes through animated GIFs without touching the canvas', async () => {
        const bitmap = vi.fn();
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = bitmap;
        // Build an animated-GIF-shaped blob: header + two GCE markers.
        const bytes = new Uint8Array(128);
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
        bytes.set([0x21, 0xF9], 20);
        bytes.set([0x21, 0xF9], 60);
        const file = new File([bytes], 'anim.gif', { type: 'image/gif' });
        const result = await compressImage(file, PRODUCT_PRESET);
        expect(result).toBe(file);
        expect(bitmap).not.toHaveBeenCalled();
    });
});
