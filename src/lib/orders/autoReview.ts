import { createSupabaseAdminClient } from '../core/supabase-admin';
import type { Strings } from '../core/i18n';
import { pickOne, type JoinedVariant } from './orderJoins';

export async function createAutoReviewsForOrder(orderId: string, t: Strings): Promise<void> {
    try {
        const adminClient = createSupabaseAdminClient();

        const { data: items } = await adminClient
            .from('order_items')
            .select('product_variants(product_id)')
            .eq('order_id', orderId);

        const productIdSet = new Set<string>();
        for (const rawItem of items ?? []) {
            const item = rawItem as { product_variants?: JoinedVariant | JoinedVariant[] | null };
            const variant = pickOne(item.product_variants);
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
                comment: t.autoReviewComment,
                is_auto: true,
            }))
        );
    } catch (err) {
        console.error(JSON.stringify({
            event: 'auto_review.failed_silent',
            orderId,
            error: err instanceof Error ? err.message : String(err),
        }));
    }
}
