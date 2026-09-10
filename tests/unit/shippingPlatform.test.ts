import { describe, it, expect } from 'vitest';
import {
    SHIPPING_PLATFORMS,
    DEFAULT_SHIPPING_PLATFORMS,
    isShippingPlatform,
    carrierKeyToPlatform,
    normalizeShippingPlatforms,
    intersectShippingPlatforms,
    servicePointCarriersForPlatforms,
    platformForServicePointCarrier,
    platformForDelivery,
} from '../../src/lib/shipping/shippingPlatform';

describe('isShippingPlatform', () => {
    it('accepts only known platforms', () => {
        expect(isShippingPlatform('inpost')).toBe(true);
        expect(isShippingPlatform('correos')).toBe(true);
        expect(isShippingPlatform('seur')).toBe(false);
        expect(isShippingPlatform(null)).toBe(false);
        expect(isShippingPlatform(undefined)).toBe(false);
    });
});

describe('carrierKeyToPlatform', () => {
    it('maps each carrier key to its platform', () => {
        expect(carrierKeyToPlatform('inpost')).toBe('inpost');
        expect(carrierKeyToPlatform('correos_home')).toBe('correos');
        expect(carrierKeyToPlatform('correos_pickup')).toBe('correos');
    });
});

describe('normalizeShippingPlatforms', () => {
    it('keeps valid platforms in canonical order', () => {
        expect(normalizeShippingPlatforms(['correos', 'inpost'])).toEqual(['inpost', 'correos']);
    });

    it('drops unknown values', () => {
        expect(normalizeShippingPlatforms(['inpost', 'seur', 'x'])).toEqual(['inpost']);
    });

    it('falls back to all platforms when empty or invalid', () => {
        expect(normalizeShippingPlatforms([])).toEqual(DEFAULT_SHIPPING_PLATFORMS);
        expect(normalizeShippingPlatforms(null)).toEqual(DEFAULT_SHIPPING_PLATFORMS);
        expect(normalizeShippingPlatforms(['nope'])).toEqual(DEFAULT_SHIPPING_PLATFORMS);
    });

    it('dedupes repeated values', () => {
        expect(normalizeShippingPlatforms(['inpost', 'inpost'])).toEqual(['inpost']);
    });
});

describe('intersectShippingPlatforms', () => {
    it('returns platforms supported by every shop', () => {
        expect(intersectShippingPlatforms([['inpost', 'correos'], ['correos']])).toEqual(['correos']);
        expect(intersectShippingPlatforms([['inpost', 'correos'], ['inpost', 'correos']])).toEqual(['inpost', 'correos']);
    });

    it('can be empty when shops have no common platform', () => {
        expect(intersectShippingPlatforms([['inpost'], ['correos']])).toEqual([]);
    });

    it('falls back to all platforms with no shops', () => {
        expect(intersectShippingPlatforms([])).toEqual(DEFAULT_SHIPPING_PLATFORMS);
    });
});

describe('servicePointCarriersForPlatforms', () => {
    it('maps platforms to sendcloud carrier codes', () => {
        expect(servicePointCarriersForPlatforms(['inpost', 'correos'])).toEqual(['inpost_es', 'correos']);
        expect(servicePointCarriersForPlatforms(['correos'])).toEqual(['correos']);
        expect(servicePointCarriersForPlatforms([])).toEqual([]);
    });

    // Sendcloud rejects the whole request with a 400 when asked for `inpost`:
    // the Spanish network is `inpost_es`.
    it('asks sendcloud for inpost_es, never inpost', () => {
        expect(servicePointCarriersForPlatforms(['inpost'])).toEqual(['inpost_es']);
    });
});

describe('platformForServicePointCarrier', () => {
    it('maps sendcloud country-suffixed codes back to platforms', () => {
        expect(platformForServicePointCarrier('inpost_es')).toBe('inpost');
        expect(platformForServicePointCarrier('correos')).toBe('correos');
        expect(platformForServicePointCarrier('CORREOS_ES')).toBe('correos');
    });

    it('returns null for carriers we do not ship with', () => {
        expect(platformForServicePointCarrier('seur')).toBeNull();
        expect(platformForServicePointCarrier('')).toBeNull();
        expect(platformForServicePointCarrier(null)).toBeNull();
        expect(platformForServicePointCarrier(undefined)).toBeNull();
    });
});

describe('platformForDelivery', () => {
    it('home delivery always ships with correos', () => {
        expect(platformForDelivery('home')).toBe('correos');
    });

    it('pickup derives from the point carrier', () => {
        expect(platformForDelivery('pickup_point', 'InPost')).toBe('inpost');
        expect(platformForDelivery('pickup_point', 'Correos')).toBe('correos');
        expect(platformForDelivery('pickup_point', null)).toBe('correos');
    });

    it('returns null for unknown delivery types', () => {
        expect(platformForDelivery('teleport')).toBeNull();
        expect(platformForDelivery(null)).toBeNull();
    });
});

describe('SHIPPING_PLATFORMS', () => {
    it('contains exactly inpost and correos', () => {
        expect(SHIPPING_PLATFORMS).toEqual(['inpost', 'correos']);
    });
});
