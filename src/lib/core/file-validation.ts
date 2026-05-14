export type AllowedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export const ALLOWED_IMAGE_TYPES: AllowedImageMimeType[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];

type MagicCheck = (b: Uint8Array) => boolean;

const MAGIC: Record<AllowedImageMimeType, MagicCheck> = {
    'image/jpeg': (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
    'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
    // RIFF....WEBP
    'image/webp': (b) =>
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    // GIF87a or GIF89a
    'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
};

/**
 * Reads the first 12 bytes of a File and returns the detected MIME type,
 * or null if it does not match any allowed image format.
 * Use this instead of trusting file.type (client-declared).
 */
export async function detectImageMimeType(file: File): Promise<AllowedImageMimeType | null> {
    const buffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    for (const [mimeType, check] of Object.entries(MAGIC) as [AllowedImageMimeType, MagicCheck][]) {
        if (check(bytes)) return mimeType;
    }
    return null;
}
