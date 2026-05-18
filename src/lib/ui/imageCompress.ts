/**
 * Client-side image compression for Supabase uploads.
 * Re-encodes to WebP and optionally center-crops (cover) or fits within a bounding box (contain).
 * Falls back to the original file if anything goes wrong or if WebP is larger.
 */

export type CompressMode = 'contain' | 'cover';

export interface CompressOptions {
    maxWidth: number;
    maxHeight: number;
    mode?: CompressMode;
    quality?: number;
}

export interface CompressPreset extends CompressOptions {
    mode: CompressMode;
    quality: number;
}

export const AVATAR_PRESET: CompressPreset = {
    maxWidth: 320,
    maxHeight: 320,
    mode: 'cover',
    quality: 0.85,
};

export const SHOP_LOGO_PRESET: CompressPreset = {
    maxWidth: 320,
    maxHeight: 320,
    mode: 'cover',
    quality: 0.85,
};

export const SHOP_BANNER_PRESET: CompressPreset = {
    maxWidth: 2000,
    maxHeight: 800,
    mode: 'contain',
    quality: 0.82,
};

export const PRODUCT_PRESET: CompressPreset = {
    maxWidth: 1600,
    maxHeight: 1600,
    mode: 'contain',
    quality: 0.85,
};

export const INCIDENT_PRESET: CompressPreset = {
    maxWidth: 1600,
    maxHeight: 1600,
    mode: 'contain',
    quality: 0.82,
};

export interface DrawPlan {
    canvasW: number;
    canvasH: number;
    srcX: number;
    srcY: number;
    srcW: number;
    srcH: number;
    dstW: number;
    dstH: number;
}

export function planDraw(
    srcW: number,
    srcH: number,
    maxW: number,
    maxH: number,
    mode: CompressMode,
): DrawPlan {
    if (mode === 'cover') {
        // Center-crop to the target aspect, then scale into the target box.
        // Never upscale: target dimensions are clamped to source.
        const targetW = Math.min(maxW, srcW);
        const targetH = Math.min(maxH, srcH);
        const srcRatio = srcW / srcH;
        const dstRatio = targetW / targetH;
        let cropW = srcW;
        let cropH = srcH;
        if (srcRatio > dstRatio) {
            cropW = Math.round(srcH * dstRatio);
        } else {
            cropH = Math.round(srcW / dstRatio);
        }
        return {
            canvasW: targetW,
            canvasH: targetH,
            srcX: Math.round((srcW - cropW) / 2),
            srcY: Math.round((srcH - cropH) / 2),
            srcW: cropW,
            srcH: cropH,
            dstW: targetW,
            dstH: targetH,
        };
    }
    // contain: downscale only, preserve aspect ratio.
    const scale = Math.min(1, maxW / srcW, maxH / srcH);
    const dw = Math.max(1, Math.round(srcW * scale));
    const dh = Math.max(1, Math.round(srcH * scale));
    return {
        canvasW: dw,
        canvasH: dh,
        srcX: 0,
        srcY: 0,
        srcW,
        srcH,
        dstW: dw,
        dstH: dh,
    };
}

export function renameToWebp(name: string): string {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base || 'image'}.webp`;
}

export function isAnimatedGif(bytes: Uint8Array): boolean {
    if (bytes.length < 6) return false;
    if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false;
    // Animated GIFs have multiple Graphic Control Extension blocks (0x21 0xF9).
    let count = 0;
    for (let i = 13; i < bytes.length - 1 && count < 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xF9) count++;
    }
    return count >= 2;
}

async function canvasToWebpBlob(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    quality: number,
): Promise<Blob | null> {
    if ('convertToBlob' in canvas) {
        try {
            return await canvas.convertToBlob({ type: 'image/webp', quality });
        } catch {
            return null;
        }
    }
    return new Promise((resolve) => {
        (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/webp', quality);
    });
}

export async function compressImage(file: File, opts: CompressOptions): Promise<File> {
    if (typeof window === 'undefined') return file;
    if (typeof createImageBitmap !== 'function') return file;

    const quality = opts.quality ?? 0.85;
    const mode: CompressMode = opts.mode ?? 'contain';

    // Animated GIFs: passthrough — canvas would flatten to a single frame.
    if (file.type === 'image/gif') {
        try {
            const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
            if (isAnimatedGif(head)) return file;
        } catch {
            return file;
        }
    }

    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return file;
    }

    try {
        const srcW = bitmap.width;
        const srcH = bitmap.height;
        if (!srcW || !srcH) return file;

        const plan = planDraw(srcW, srcH, opts.maxWidth, opts.maxHeight, mode);

        let canvas: OffscreenCanvas | HTMLCanvasElement;
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(plan.canvasW, plan.canvasH);
            ctx = canvas.getContext('2d');
        } else {
            const c = document.createElement('canvas');
            c.width = plan.canvasW;
            c.height = plan.canvasH;
            canvas = c;
            ctx = c.getContext('2d');
        }
        if (!ctx) return file;

        if ('imageSmoothingQuality' in ctx) {
            (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
        }
        ctx.drawImage(
            bitmap,
            plan.srcX,
            plan.srcY,
            plan.srcW,
            plan.srcH,
            0,
            0,
            plan.dstW,
            plan.dstH,
        );

        const blob = await canvasToWebpBlob(canvas, quality);
        if (!blob) return file;
        if (blob.size >= file.size) return file;

        return new File([blob], renameToWebp(file.name), {
            type: 'image/webp',
            lastModified: Date.now(),
        });
    } catch {
        return file;
    } finally {
        try {
            bitmap.close?.();
        } catch {
            // ignore
        }
    }
}
