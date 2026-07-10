import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMaxLabelPriceEurMock = vi.fn();

vi.mock('../../src/lib/shipping/sendcloud', () => ({
    getMaxLabelPriceEur: (...args: unknown[]) => getMaxLabelPriceEurMock(...args),
}));

import { enforceVariantPricing, type PricingCheckVariant } from '../../src/lib/products/pricingEnforcement';
import { es } from '../../src/lib/core/i18n/strings.es';

function fmtEur(value: number): string {
    return `${value.toFixed(2).replace('.', ',')} €`;
}

function makeVariant(overrides: Partial<PricingCheckVariant> = {}): PricingCheckVariant {
    return {
        variant_name: 'Talla M',
        price: 10,
        shipping_cost: 3,
        weight_kg: 1,
        length_cm: 20,
        width_cm: 15,
        height_cm: 10,
        ...overrides,
    };
}

describe('enforceVariantPricing', () => {
    beforeEach(() => {
        getMaxLabelPriceEurMock.mockReset();
    });

    it('returns ok:true immediately for an empty variant list without calling Sendcloud', async () => {
        const result = await enforceVariantPricing(es, []);
        expect(result).toEqual({ ok: true, errors: [] });
        expect(getMaxLabelPriceEurMock).not.toHaveBeenCalled();
    });

    it('passes weight and dimensions through to getMaxLabelPriceEur', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5);
        const variant = makeVariant({ weight_kg: 2, length_cm: 30, width_cm: 20, height_cm: 10, price: 20, shipping_cost: 1 });
        await enforceVariantPricing(es, [variant]);
        expect(getMaxLabelPriceEurMock).toHaveBeenCalledWith(2, 30, 20, 10);
    });

    it('skips the API call and reports "label unavailable" when weight is zero or negative', async () => {
        const variants = [makeVariant({ weight_kg: 0 }), makeVariant({ weight_kg: -1 })];
        const result = await enforceVariantPricing(es, variants);

        expect(getMaxLabelPriceEurMock).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toBe(
            es.sellerProductPricingLabelUnavailable.replace('{variant}', 'Talla M'),
        );
    });

    it('skips the API call and reports "label unavailable" when weight is not finite', async () => {
        const result = await enforceVariantPricing(es, [makeVariant({ weight_kg: NaN })]);
        expect(getMaxLabelPriceEurMock).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
    });

    it('reports "label unavailable" when the Sendcloud quote throws', async () => {
        getMaxLabelPriceEurMock.mockRejectedValueOnce(new Error('network down'));
        const result = await enforceVariantPricing(es, [makeVariant()]);

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([
            es.sellerProductPricingLabelUnavailable.replace('{variant}', 'Talla M'),
        ]);
    });

    it('reports "label unavailable" when the Sendcloud quote resolves null', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(null);
        const result = await enforceVariantPricing(es, [makeVariant()]);
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([
            es.sellerProductPricingLabelUnavailable.replace('{variant}', 'Talla M'),
        ]);
    });

    it('falls back to a generic variant label when variant_name is missing or blank', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(null);
        const result = await enforceVariantPricing(es, [makeVariant({ variant_name: '   ' })]);
        expect(result.errors).toEqual([
            es.sellerProductPricingLabelUnavailable.replace(
                '{variant}',
                es.sellerProductPricingVariantFallbackName,
            ),
        ]);
    });

    it('returns ok:true with no errors when pricing is valid', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5);
        const result = await enforceVariantPricing(es, [makeVariant({ price: 8, shipping_cost: 3 })]);
        expect(result).toEqual({ ok: true, errors: [] });
    });

    it('reports price_below_min with the correct message', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(4);
        const result = await enforceVariantPricing(es, [makeVariant({ price: 0.5, shipping_cost: 10 })]);

        expect(result.ok).toBe(false);
        expect(result.errors).toContain(
            es.sellerProductPricingPriceBelowMin.replace('{variant}', 'Talla M'),
        );
    });

    it('reports shipping_exceeds_label with charged/maxLabel amounts formatted in EUR', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5);
        const result = await enforceVariantPricing(es, [makeVariant({ price: 20, shipping_cost: 7 })]);

        const expected = es.sellerProductPricingShippingExceedsLabel
            .replace('{variant}', 'Talla M')
            .replace('{charged}', fmtEur(7))
            .replace('{maxLabel}', fmtEur(5));
        expect(result.errors).toContain(expected);
    });

    it('reports margin_below_floor with total/maxLabel amounts formatted in EUR', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5);
        const result = await enforceVariantPricing(es, [makeVariant({ price: 2, shipping_cost: 1 })]);

        const expected = es.sellerProductPricingMarginTooLow
            .replace('{variant}', 'Talla M')
            .replace('{total}', fmtEur(3))
            .replace('{maxLabel}', fmtEur(5));
        expect(result.errors).toContain(expected);
    });

    it('can report multiple violations for the same variant', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(4);
        const result = await enforceVariantPricing(es, [makeVariant({ price: 0.5, shipping_cost: 1 })]);

        expect(result.errors.length).toBeGreaterThanOrEqual(2);
        expect(result.errors.some((e) => e.includes('mínimo'))).toBe(true);
    });

    it('evaluates every variant independently and aggregates all errors', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5).mockResolvedValueOnce(5);
        const variants = [
            makeVariant({ variant_name: 'OK', price: 8, shipping_cost: 3 }),
            makeVariant({ variant_name: 'Bad', price: 0.5, shipping_cost: 10 }),
        ];
        const result = await enforceVariantPricing(es, variants);

        expect(result.ok).toBe(false);
        // "Bad" (price 0.5, shipping 10, maxLabel 5) triggers both price_below_min
        // and shipping_exceeds_label; "OK" triggers nothing.
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.every((e) => e.includes('Bad'))).toBe(true);
        expect(getMaxLabelPriceEurMock).toHaveBeenCalledTimes(2);
    });

    it('treats non-numeric price/shipping as 0 when validating', async () => {
        getMaxLabelPriceEurMock.mockResolvedValueOnce(5);
        const result = await enforceVariantPricing(
            es,
            [makeVariant({ price: null, shipping_cost: undefined })],
        );
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});
