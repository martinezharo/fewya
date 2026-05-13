import { createSupabaseAdminClient } from '../core/supabase-admin';
import { strings } from '../core/i18n';

export async function createAutoReviewsForOrder(orderId: string): Promise<void> {
    try {
        const adminClient = createSupabaseAdminClient();

        const { data: items } = await adminClient
            .from('order_items')
            .select('product_variants(product_id)')
            .eq('order_id', orderId);

        const productIdSet = new Set<string>();
        for (const item of items ?? []) {
            const variant = Array.isArray((item as any).product_variants)
                ? (item as any).product_variants[0]
                : (item as any).product_variants;
            if (variant?.product_id) productIdSet.add(variant.product_id);
        }

        const productIds = [...productIdSet];
        if (productIds.length === 0) return;

        const { data: existing } = await adminClient
            .from('reviews')
            .select('product_id')
            .in('product_id', productIds);

        const reviewedIds = new Set((existing ?? []).map((r) => r.product_id));
        const unreviewed = productIds.filter((id) => !reviewedIds.has(id));
        if (unreviewed.length === 0) return;

        await adminClient.from('reviews').insert(
            unreviewed.map((product_id) => ({
                product_id,
                profile_id: null,
                rating: 5,
                comment: strings.autoReviewComment,
                is_auto: true,
            }))
        );
    } catch (err) {
        console.error('createAutoReviewsForOrder failed silently', err);
    }
}
