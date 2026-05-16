import { strings } from '../core/i18n';

export interface ProductCompletenessResult {
    complete: boolean;
    missing: string[];
}

export function validateProductCompleteness(
    product: Record<string, any>,
    variants: Record<string, any>[]
): ProductCompletenessResult {
    const missing: string[] = [];

    if (!product.title?.trim()) missing.push('nombre');
    if (!product.description?.trim()) missing.push('descripción');
    if (!product.category?.trim()) missing.push('categoría');
    if (!product.slug?.trim()) missing.push('URL');
    if (!product.gallery_images || product.gallery_images.length === 0) missing.push('fotos');

    if (!variants || variants.length === 0) {
        missing.push('variantes');
    } else {
        const allVariantsValid = variants.every(
            (v) =>
                (v.price ?? 0) > 0 &&
                (v.stock ?? -1) >= 0 &&
                v.weight_kg != null && v.weight_kg > 0 &&
                v.length_cm != null && v.length_cm > 0 &&
                v.width_cm != null && v.width_cm > 0 &&
                v.height_cm != null && v.height_cm > 0 &&
                v.shipping_cost != null && v.shipping_cost >= 0
        );

        if (!allVariantsValid) {
            missing.push('todas las variantes con precio, stock y datos de envío completos');
        }
    }

    return { complete: missing.length === 0, missing };
}

export function formatShippingDisplay(cost: number | null | undefined): string {
    if (cost == null) return '';
    if (cost === 0) return strings.freeShipping;
    return `+${cost.toFixed(2).replace('.', ',')}€ envío`;
}

export function isProductComplete(product: Record<string, any>): boolean {
    return validateProductCompleteness(product, product.variants ?? []).complete;
}

/**
 * Validates only the fields strictly required for checkout.
 * This is intentionally narrower than `isProductComplete` because
 * the checkout API does not fetch description/category/dimensions.
 */
export function validateCheckoutReadiness(
    product: Record<string, any>,
    variant: Record<string, any>,
    quantity: number
): { ready: boolean; reason?: string } {
    if (!product.is_active) {
        return { ready: false, reason: 'product_inactive' };
    }
    if (!product.title?.trim()) {
        return { ready: false, reason: 'product_incomplete' };
    }
    if ((variant.price ?? 0) <= 0) {
        return { ready: false, reason: 'invalid_price' };
    }
    if ((variant.stock ?? -1) < quantity) {
        return { ready: false, reason: 'out_of_stock' };
    }
    if ((variant.shipping_cost ?? -1) < 0) {
        return { ready: false, reason: 'missing_shipping' };
    }
    return { ready: true };
}
