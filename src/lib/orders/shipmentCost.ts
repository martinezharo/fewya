import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns the total label cost stored in `shipments.price` for an order,
 * keyed by the shop_id that should be debited.
 *
 * In Fewya each order belongs to a single shop, so this map will have at most
 * one entry (shape kept generic to match releaseOrderFunds' multi-shop API).
 */
export async function getLabelCostByShop(
    admin: SupabaseClient,
    orderId: string,
): Promise<Record<string, number>> {
    const { data, error } = await admin
        .from('orders')
        .select('shop_id, shipments(price)')
        .eq('id', orderId)
        .single();

    if (error || !data?.shop_id) return {};

    const shipments = Array.isArray(data.shipments) ? data.shipments : data.shipments ? [data.shipments] : [];
    const totalCost = shipments.reduce((sum: number, s: { price?: number | string | null } | null) => {
        const price = Number(s?.price ?? 0);
        return Number.isFinite(price) && price > 0 ? sum + price : sum;
    }, 0);

    if (totalCost <= 0) return {};
    return { [data.shop_id]: Math.round(totalCost * 100) / 100 };
}
