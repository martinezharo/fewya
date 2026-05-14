import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../../src/lib/core/timing-safe';

describe('timingSafeEqual', () => {
    it('returns true for identical strings', () => {
        expect(timingSafeEqual('secret123', 'secret123')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
        expect(timingSafeEqual('secret123', 'secret456')).toBe(false);
    });

    it('returns false for different lengths', () => {
        expect(timingSafeEqual('short', 'much-longer-string')).toBe(false);
    });

    it('returns false for empty vs non-empty', () => {
        expect(timingSafeEqual('', 'secret')).toBe(false);
    });

    it('returns true for two empty strings', () => {
        expect(timingSafeEqual('', '')).toBe(true);
    });

    it('returns false when one character differs at start', () => {
        expect(timingSafeEqual('Xbc', 'abc')).toBe(false);
    });

    it('returns false when one character differs at end', () => {
        expect(timingSafeEqual('abX', 'abc')).toBe(false);
    });

    it('handles unicode correctly', () => {
        expect(timingSafeEqual('secretñ', 'secretñ')).toBe(true);
        expect(timingSafeEqual('secretñ', 'secretn')).toBe(false);
    });
});
