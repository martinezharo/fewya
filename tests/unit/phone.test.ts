import { describe, it, expect } from 'vitest';
import { resolvePhonePrefix, defaultPhonePrefixForCountry, DEFAULT_PHONE_PREFIX } from '../../src/lib/core/phone';

describe('defaultPhonePrefixForCountry', () => {
    it('devuelve +34 para ES', () => {
        expect(defaultPhonePrefixForCountry('ES')).toBe('+34');
    });

    it('respeta mayúsculas/minúsculas', () => {
        expect(defaultPhonePrefixForCountry('es')).toBe('+34');
    });

    it('cae al default para país desconocido', () => {
        expect(defaultPhonePrefixForCountry('XX')).toBe(DEFAULT_PHONE_PREFIX);
    });

    it('cae al default si el país es null/undefined', () => {
        expect(defaultPhonePrefixForCountry(null)).toBe(DEFAULT_PHONE_PREFIX);
        expect(defaultPhonePrefixForCountry(undefined)).toBe(DEFAULT_PHONE_PREFIX);
    });

    it('soporta PT, FR, AD', () => {
        expect(defaultPhonePrefixForCountry('PT')).toBe('+351');
        expect(defaultPhonePrefixForCountry('FR')).toBe('+33');
        expect(defaultPhonePrefixForCountry('AD')).toBe('+376');
    });
});

describe('resolvePhonePrefix', () => {
    it('prefiere phone_prefix explícito si está presente', () => {
        expect(resolvePhonePrefix({ phone_prefix: '+44', address_country: 'ES' })).toBe('+44');
    });

    it('deriva del país si phone_prefix está vacío', () => {
        expect(resolvePhonePrefix({ phone_prefix: '', address_country: 'PT' })).toBe('+351');
        expect(resolvePhonePrefix({ phone_prefix: null, address_country: 'FR' })).toBe('+33');
    });

    it('default si no hay nada que usar', () => {
        expect(resolvePhonePrefix(null)).toBe(DEFAULT_PHONE_PREFIX);
        expect(resolvePhonePrefix({})).toBe(DEFAULT_PHONE_PREFIX);
    });

    it('trim al prefix explícito', () => {
        expect(resolvePhonePrefix({ phone_prefix: '  +33  ' })).toBe('+33');
    });
});
