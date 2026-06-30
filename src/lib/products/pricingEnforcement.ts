import type { Strings } from '../core/i18n';
import { getMaxLabelPriceEur } from '../shipping/sendcloud';
import {
    validateVariantPricing,
    type VariantPricingViolation,
} from './productValidation';

export interface PricingCheckVariant {
    variant_name?: string | null;
    price: number | null | undefined;
    shipping_cost: number | null | undefined;
    weight_kg: number | null | undefined;
    length_cm: number | null | undefined;
    width_cm: number | null | undefined;
    height_cm: number | null | undefined;
}

export interface PricingCheckResult {
    ok: boolean;
    errors: string[];
}

function fmtEur(value: number): string {
    return `${value.toFixed(2).replace('.', ',')} €`;
}

function variantLabel(t: Strings, v: PricingCheckVariant): string {
    const name = v.variant_name?.trim();
    return name && name.length > 0 ? name : t.sellerProductPricingVariantFallbackName;
}

function messageFor(
    t: Strings,
    code: VariantPricingViolation,
    v: PricingCheckVariant,
    maxLabel: number,
): string {
    const price = Number(v.price) || 0;
    const shipping = Number(v.shipping_cost) || 0;
    const variant = variantLabel(t, v);

    switch (code) {
        case 'price_below_min':
            return t.sellerProductPricingPriceBelowMin.replace('{variant}', variant);
        case 'shipping_exceeds_label':
            return t.sellerProductPricingShippingExceedsLabel
                .replace('{variant}', variant)
                .replace('{charged}', fmtEur(shipping))
                .replace('{maxLabel}', fmtEur(maxLabel));
        case 'margin_below_floor':
            return t.sellerProductPricingMarginTooLow
                .replace('{variant}', variant)
                .replace('{total}', fmtEur(price + shipping))
                .replace('{maxLabel}', fmtEur(maxLabel));
    }
}

export async function enforceVariantPricing(
    t: Strings,
    variants: PricingCheckVariant[],
): Promise<PricingCheckResult> {
    if (!variants.length) return { ok: true, errors: [] };

    const errors: string[] = [];

    const maxLabels = await Promise.all(
        variants.map(async (v) => {
            const weight = Number(v.weight_kg);
            if (!Number.isFinite(weight) || weight <= 0) return null;
            try {
                return await getMaxLabelPriceEur(weight, v.length_cm, v.width_cm, v.height_cm);
            } catch (err) {
                console.error('enforceVariantPricing: Sendcloud quote failed', err);
                return undefined;
            }
        }),
    );

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const maxLabel = maxLabels[i];

        if (maxLabel === undefined || maxLabel === null) {
            errors.push(
                t.sellerProductPricingLabelUnavailable.replace(
                    '{variant}',
                    variantLabel(t, v),
                ),
            );
            continue;
        }

        const codes = validateVariantPricing({
            price: Number(v.price) || 0,
            shipping_cost: Number(v.shipping_cost) || 0,
            maxLabelPriceEur: maxLabel,
        });

        for (const code of codes) {
            errors.push(messageFor(t, code, v, maxLabel));
        }
    }

    return { ok: errors.length === 0, errors };
}
