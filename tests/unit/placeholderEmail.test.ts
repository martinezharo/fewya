import { describe, it, expect } from 'vitest';
import { isPlaceholderEmail, placeholderEmail, realEmail } from '../../convex/lib/placeholderEmail';

describe('placeholderEmail', () => {
    it('mints an address on a domain that can never resolve', () => {
        expect(placeholderEmail('user_abc')).toBe('clerk-user_abc@invalid.local');
        expect(isPlaceholderEmail(placeholderEmail('user_abc'))).toBe(true);
    });

    // The Supabase importer used a different prefix for the same purpose.
    it('recognizes the imported stand-in too', () => {
        expect(isPlaceholderEmail('unknown+3e2c19e0@invalid.local')).toBe(true);
    });

    it('is not fooled by case or surrounding space', () => {
        expect(isPlaceholderEmail('  Clerk-User_A@INVALID.LOCAL ')).toBe(true);
    });

    it('leaves a real address alone', () => {
        expect(isPlaceholderEmail('buyer@fewya.com')).toBe(false);
        expect(realEmail('  buyer@fewya.com  ')).toBe('buyer@fewya.com');
    });

    // A lookalike local part is not a stand-in: only the reserved domain is.
    it('does not treat a real address that mentions clerk as a stand-in', () => {
        expect(isPlaceholderEmail('clerk-user_abc@fewya.com')).toBe(false);
        expect(realEmail('clerk-user_abc@fewya.com')).toBe('clerk-user_abc@fewya.com');
    });

    it('answers null for anything that cannot receive mail', () => {
        expect(realEmail(placeholderEmail('user_abc'))).toBeNull();
        expect(realEmail(null)).toBeNull();
        expect(realEmail(undefined)).toBeNull();
        expect(realEmail('   ')).toBeNull();
    });
});
