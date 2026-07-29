import type { ProductVariant } from '../core/types';

/**
 * Shared variant selection / stock helpers.
 *
 * The rules for "which variant represents this product" and "is this product
 * buyable" were previously re-implemented inline in the product page, both
 * product cards and the seller catalog. Keeping them here means the storefront,
 * the seller dashboard and the public catalog feed can never drift apart.
 */

type VariantLike = Pick<ProductVariant, 'stock' | 'is_default'> & Partial<ProductVariant>;

/** Variants ordered for display: the default one first, rest in fetch order. */
export function sortVariants<T extends VariantLike>(variants: T[] | null | undefined): T[] {
    return [...(variants ?? [])].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
}

/**
 * The variant a product is represented by (price shown on cards, SKU in JSON-LD).
 * Falls back to the first variant when no default is flagged, so a product with
 * a mis-seeded variant set still renders a price instead of 0.
 */
export function getDefaultVariant<T extends VariantLike>(variants: T[] | null | undefined): T | undefined {
    return variants?.find(v => v.is_default) ?? variants?.[0];
}

/** Total units across every variant. */
export function getTotalStock(variants: VariantLike[] | null | undefined): number {
    return (variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);
}

/** True when at least one variant has units left. Empty variant set counts as out of stock. */
export function isInStock(variants: VariantLike[] | null | undefined): boolean {
    return (variants ?? []).some(v => (v.stock ?? 0) > 0);
}
