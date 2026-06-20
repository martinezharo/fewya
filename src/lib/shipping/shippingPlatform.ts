import type { CarrierKey } from './carrierKey';

// A "shipping platform" is the carrier brand a shop ships with. Each platform
// groups one or more delivery CarrierKeys:
//   - inpost   → inpost (locker pickup)
//   - correos  → correos_home (home delivery) + correos_pickup (office pickup)
// Sellers can disable platforms they don't want to ship with, but at least one
// must always remain enabled.
export type ShippingPlatform = 'inpost' | 'correos';

export const SHIPPING_PLATFORMS: ShippingPlatform[] = ['inpost', 'correos'];
export const DEFAULT_SHIPPING_PLATFORMS: ShippingPlatform[] = ['inpost', 'correos'];

export function isShippingPlatform(value: unknown): value is ShippingPlatform {
    return value === 'inpost' || value === 'correos';
}

export function carrierKeyToPlatform(key: CarrierKey): ShippingPlatform {
    return key === 'inpost' ? 'inpost' : 'correos';
}

/**
 * Coerce arbitrary input (DB array, request body) into a clean, ordered list of
 * valid platforms. Falls back to all platforms when the input is empty or
 * invalid so we never end up with a shop that can't ship at all.
 */
export function normalizeShippingPlatforms(input: unknown): ShippingPlatform[] {
    if (!Array.isArray(input)) return [...DEFAULT_SHIPPING_PLATFORMS];
    const present = new Set<ShippingPlatform>();
    for (const value of input) {
        if (isShippingPlatform(value)) present.add(value);
    }
    const result = SHIPPING_PLATFORMS.filter((platform) => present.has(platform));
    return result.length > 0 ? result : [...DEFAULT_SHIPPING_PLATFORMS];
}

/**
 * Intersection of enabled platforms across several shops. Used at checkout when
 * a single delivery choice is applied to every shop in the cart: only platforms
 * that ALL shops support can be offered to the buyer.
 */
export function intersectShippingPlatforms(lists: ShippingPlatform[][]): ShippingPlatform[] {
    if (lists.length === 0) return [...DEFAULT_SHIPPING_PLATFORMS];
    return SHIPPING_PLATFORMS.filter((platform) => lists.every((list) => list.includes(platform)));
}

// Sendcloud service-point carrier codes for a set of platforms.
export function servicePointCarriersForPlatforms(platforms: ShippingPlatform[]): string[] {
    const carriers: string[] = [];
    if (platforms.includes('correos')) carriers.push('correos');
    if (platforms.includes('inpost')) carriers.push('inpost');
    return carriers;
}

/**
 * Resolve the platform a given delivery selection ships with.
 *   - home delivery   → always 'correos'
 *   - pickup point    → derived from the chosen point's carrier
 */
export function platformForDelivery(
    deliveryType: string | null | undefined,
    pickupPointCarrier?: string | null,
): ShippingPlatform | null {
    if (deliveryType === 'home') return 'correos';
    if (deliveryType === 'pickup_point') {
        const carrier = (pickupPointCarrier || '').toLowerCase();
        if (carrier.includes('inpost')) return 'inpost';
        return 'correos';
    }
    return null;
}
