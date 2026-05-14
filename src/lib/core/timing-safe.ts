/**
 * Constant-time string comparison using XOR to prevent timing attacks.
 * Required for webhook secret validation where early exit could leak info.
 */
export function timingSafeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const aBytes = encoder.encode(a);
    const bBytes = encoder.encode(b);

    const len = Math.max(aBytes.length, bBytes.length);
    const aPadded = new Uint8Array(len);
    const bPadded = new Uint8Array(len);
    aPadded.set(aBytes);
    bPadded.set(bBytes);

    let diff = aBytes.length !== bBytes.length ? 1 : 0;
    for (let i = 0; i < len; i++) {
        diff |= aPadded[i] ^ bPadded[i];
    }
    return diff === 0;
}
