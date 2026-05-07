import type { Product } from '../core/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Enrich an array of products with average_rating and review_count
 * by querying the reviews table. Modifies the products in-place and returns them.
 */
export async function enrichProductsWithRatings(
    products: Product[],
    supabaseClient: SupabaseClient
): Promise<Product[]> {
    if (products.length === 0) return products;

    const productIds = products.map(p => p.id);

    const { data: reviewsData } = await supabaseClient
        .from('reviews')
        .select('product_id, rating')
        .in('product_id', productIds);

    if (!reviewsData || reviewsData.length === 0) return products;

    // Aggregate ratings per product
    const ratingsMap = new Map<string, { sum: number; count: number }>();
    for (const review of reviewsData) {
        const entry = ratingsMap.get(review.product_id) ?? { sum: 0, count: 0 };
        entry.sum += review.rating;
        entry.count += 1;
        ratingsMap.set(review.product_id, entry);
    }

    // Enrich products
    for (const product of products) {
        const stats = ratingsMap.get(product.id);
        if (stats) {
            product.review_avg = stats.sum / stats.count;
            product.review_count = stats.count;
        }
    }

    return products;
}
